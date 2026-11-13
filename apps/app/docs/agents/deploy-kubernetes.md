# Kubernetes

Read when running a Project on Kubernetes or on more than one instance. It is written for up to about 12 pods per role, a highly available Postgres (alone or behind PgBouncer) and a highly available Redis. [deploy.md](deploy.md) holds the rules that apply on any runner.

## Roles

One image, three entries (see the `Dockerfile` header):

- **Server**: a Deployment behind a Service. Serves pages, the API and live updates.
- **Worker**: a Deployment with no Service. Runs Consumers and Schedules.
- **migrate**: a Job, run once per rollout, before any pod of the new version starts. It migrates the tables and the queue, and it alone adds, updates and removes Schedules. Do not make it an init container: a pod of the previous version that restarts mid-rollout would run the old migrate and undo the new Schedules.

Give migrate the same variables as the Worker, `SCHEDULE_<NAME>` included: a cron override acts only in migrate, and a Worker reads only `off`. A Worker that logs "Schedule is not in the database" started without a migrate: run it, then restart the Worker.

## Probes

All three probes use `HEALTH_PORT` (9000). A dependency that is down keeps new pods from starting and never restarts a running one.

- **Liveness** (`/livez`) is the process only. The Server always passes. The Worker fails only when its own poll loop has hung for 60 s. Postgres, Redis or the broker being down never fails it, so running pods ride out a failover and carry on by themselves.
- **Startup.** The health port opens only after secrets load, and a Server or Worker that cannot reach Postgres or Redis (the Server: also the identity provider) exits 1 at boot. So during an outage new pods crash-loop, never become ready, and a rollout stalls with the old pods still serving.
- **Readiness** (`/readyz`) is 200 once the pod has booted and listens, and 503 from SIGTERM on. It does not ask Postgres again on a running pod.

Values: startup `/livez` every 2 s, 30 failures allowed; readiness `/readyz` every 5 s; liveness `/livez` every 10 s, 3 failures. Never add a dependency check to liveness, and keep the pool's query timeout (15 s) well under 60 s: the Worker's rule needs a poll that fails, not one that hangs.

## Pool sizing

Every process opens at most `DATABASE_POOL_MAX` Postgres connections (unset: 10 in a Server, 5 in a Worker). The queue shares that pool. A Worker runs at most pool max minus 1 Events and Schedule runs at once, whatever its number of Consumers, so raise `DATABASE_POOL_MAX` on Workers to run more per pod.

```
(Server pods + surge) x Server max + (Worker pods + surge) x Worker max + 5
    <= max_connections - superuser_reserved_connections
```

The 5 are for migrate (at most 2 at a time) and people. Surge pods count: old and new pods overlap in a rollout.

Worked example, 12 pods: 8 Servers and 4 Workers, `maxSurge: 25%` (2 and 1 more), Postgres at `max_connections=100` with 3 reserved, so 97.

- Defaults: 10 x 10 + 5 x 5 + 5 = 130. Too many: pods fail with "too many clients".
- `DATABASE_POOL_MAX=6` on Servers and `4` on Workers: 10 x 6 + 5 x 4 + 5 = 85. Fits. Each Worker then runs 3 at once.
- More pods or bigger pools than that: raise `max_connections`, or put PgBouncer in front.

## PgBouncer

- Runtime goes through PgBouncer in transaction mode: requests, Events, Schedules and transactions all work there. The formula above then counts against PgBouncer's `max_client_conn`, and its `default_pool_size` (one database, one user) plus the 5 must fit under `max_connections`.
- migrate must reach Postgres itself. Set `DATABASE_MIGRATE_URL` to the direct URL on the migrate Job. Without it migrate fails at once with "postgresMigrate needs a direct connection to Postgres", in every pool mode.
- migrate waits 60 s for another migrate, then fails naming its advisory lock. With no other migrate running, a session holds the lock: find it in `pg_locks` (locktype `advisory`) and end it with `pg_terminate_backend`.

## Secrets

`.env.production` holds `op()` references. A variable already set in the environment wins and is never fetched. Two ways to boot:

- **1Password at boot** (a few pods). Set `OP_SERVICE_ACCOUNT_TOKEN` and allow outbound HTTPS to 1Password. Every boot reads every reference, so a crash loop across many pods can use up the service account's read limit (1,000 an hour on 1Password Teams), and then no pod boots, healthy ones included. A 1Password outage blocks scale-up and rescheduling too.
- **Kubernetes Secret** (a fleet). Let External Secrets or the 1Password Operator sync the vault into a Secret whose keys are the names in `.env.production`, and load it with `envFrom`. Set no token: boot never calls 1Password. varlock still checks every value and redacts it in logs.

With no token, a reference that is not set fails the boot with `Invalid env vars: <NAME>`. A changed secret reaches a pod only when it restarts, either way.

## Graceful shutdown

Set `terminationGracePeriodSeconds: 30`. The process ends itself within 25 s of SIGTERM and needs no `preStop` hook.

- Server: `/readyz` turns 503 and it keeps serving for 5 s while the Service drops the pod, then finishes open requests and closes live streams (to second 20 at most), then closes its connections.
- Worker: stops fetching at once and gives running Events and Schedule runs 15 s. One still running after that is retried on another Worker 30 to 90 s later, so keep a Consumer short and safe to run twice (the Inbox).

## Load balancer

- Keep the ingress's or load balancer's idle (keep-alive) timeout under 65 s, the time the Server keeps an idle connection. Longer brings 502s on reused connections.
- Anything caching in front of the app must honour `cache-control: no-store` on a 404 under `/assets/`. Never cache 404s by default.

## Rolling deploys

Old and new pods run side by side for minutes. Use `maxUnavailable: 0` on the Server.

- **Tables** change by expand, then contract ([data.md](data.md)).
- **Event shapes** change in three releases: widen, switch, narrow ([events-and-bridges.md](events-and-bridges.md)).
- **UI assets.** A page can get its `/assets/` files from a pod of the other version. The app answers such a miss with an uncached 404 and the page reloads itself once, which fixes most page views, not all. To close the window choose one: serve `/assets/` from shared storage or a CDN that keeps the previous build's files beside the new ones (upload `build/client/assets` before the rollout, keep old files a day), or cookie-based session affinity at the ingress, so one browser stays on one version.
- **Rollback.** A release that moved Events to ordered queues (`@n8io/baseline-queue` 8) rolls out with no manual step, but do not roll back across it after a week: by then migrate has removed the old queues and the old release's publishes would be lost silently.

## Redis outage

A Redis outage or failover fails no request.

- Cached reads become database reads. Each first waits up to 1 s for Redis, so reads are slower and Postgres takes more load until Redis is back.
- Live updates sent meanwhile are lost. Open pages catch up within 5 s of Redis returning, without a reload.
- After a write whose cache clear was lost, other pods may serve the old value until its entry expires: 60 s by default. For a value that cannot be that stale, shorten `ttlMs` or do not cache it.
- A new pod still needs Redis to boot.

## Event order

Events with the same Event key run one at a time, in commit order, on any number of Workers. Other Event keys run beside them.

An Event that fails five times stays failed and blocks its Event key; other keys carry on. Decide within 7 days: after that it is deleted and the key moves on without it. `queue.blockedKeys()` lists what is blocked, and the runbook (run it again, or give it up) is "A blocked key" in the `@n8io/baseline-queue` README.

## Redis high availability

`src/redis.ts` opens one connection to one URL with `createClient`. That fits an endpoint that follows the primary: a managed highly available Redis, or a proxy in front of Sentinel. Use `rediss://` for TLS. After a drop it reconnects by itself, every 100 ms at first, slowing to every 2 s, and never gives up.

Sentinel or Cluster addressed directly needs `createSentinel` or `createCluster` in that one file. The cache and live updates take either client, but nothing tests that path.

## Pulsar

For a Project that moved Events to `@n8io/baseline-pulsar`. It differs from the queue on purpose:

- A poison Event goes to `<queueName>.dead` after five attempts (about 150 s, during which later Events of its Event key wait) and its key then moves on. No key stays blocked and there is no `blockedKeys()`.
- Order is the order the broker received the sends, and a send happens after the commit. Two transactions on one entity that commit within milliseconds on different pods can arrive reversed.
- Events published during a broker outage are lost and counted. The outage does not fail Worker liveness.
- Upgrading to version 5 is not a rolling update. Scale the old Workers to zero, then deploy Servers and Workers. A new pod that boots while an old Worker is connected fails with "ConsumerBusy" until the old ones are gone.

## Alerts

- `baseline.queue.blocked_keys` above 0, as the maximum across pods, never the sum. Log: "Event key is blocked until released".
- `baseline.cache.store_errors` and `baseline.live.sends_failed` rising: Redis is down. One warning per 30 s per pod, not one per call.
- "Queue error", once per 30 s per queue per pod: Postgres is down.
- `baseline.queue.dead_letters`, or the log "Job failed": an Event used up its attempts.
- Pulsar: `baseline.pulsar.events_lost`.

## Known gaps

- During a Redis outage every cached read waits up to 1 s before it reads the database.
- Without shared assets or session affinity, one reload does not always fix a page of mixed versions.
- A query timeout (15 s) rejects in the app and closes the connection. It does not cancel the statement, which Postgres may still finish.
- Readiness does not check dependencies on a running pod, and nothing logs that Postgres is back.
- A Worker that started before migrate added a Schedule runs it only after a restart.
- One Consumer whose poll loop hangs is hidden from liveness while the Worker's other loops turn.
- Inbox pruning does not count toward a Worker's limit of runs at once.
- Pulsar: a Consumer run that never returns is not timed out and liveness does not see it. One Event key with a backlog of failing Events can hold all four of a Consumer's places on a Worker. During a broker outage a request that publishes waits for the send timeout (30 s) before the Event counts as lost.

## Deferred

- Rotating `AUTHN_SECRET` signs everyone out: sessions are read with one key only.
- Analytics sends one request per call, with no batching or cap. Fine at modest volume.

## Example manifests

Replace `invoicing`, the image and the counts. `invoicing-env` is the Secret from "Secrets".

```yaml
apiVersion: batch/v1
kind: Job
metadata: { name: invoicing-migrate-1-4-0 } # a new name per release
spec:
  backoffLimit: 1
  ttlSecondsAfterFinished: 86400
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: migrate
          image: registry.example.com/invoicing:1.4.0
          command: ["node", "src/migrate.ts"]
          envFrom: [{ secretRef: { name: invoicing-env } }] # with DATABASE_MIGRATE_URL behind PgBouncer
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: invoicing-server }
spec:
  replicas: 8
  strategy: { rollingUpdate: { maxSurge: 25%, maxUnavailable: 0 } }
  selector: { matchLabels: { app: invoicing-server } }
  template:
    metadata: { labels: { app: invoicing-server } }
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: server
          image: registry.example.com/invoicing:1.4.0
          ports: [{ containerPort: 3000 }, { containerPort: 9000 }]
          envFrom: [{ secretRef: { name: invoicing-env } }]
          env:
            - { name: DATABASE_POOL_MAX, value: "6" }
            - { name: OTEL_SERVICE_NAME, value: invoicing-server }
          startupProbe:
            httpGet: { path: /livez, port: 9000 }
            periodSeconds: 2
            failureThreshold: 30
          readinessProbe:
            httpGet: { path: /readyz, port: 9000 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /livez, port: 9000 }
            periodSeconds: 10
            failureThreshold: 3
---
apiVersion: apps/v1
kind: Deployment
metadata: { name: invoicing-worker }
spec:
  replicas: 4
  selector: { matchLabels: { app: invoicing-worker } }
  template:
    metadata: { labels: { app: invoicing-worker } }
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: worker
          image: registry.example.com/invoicing:1.4.0
          command: ["node", "src/worker.ts"]
          ports: [{ containerPort: 9000 }]
          envFrom: [{ secretRef: { name: invoicing-env } }]
          env:
            - { name: DATABASE_POOL_MAX, value: "4" }
            - { name: OTEL_SERVICE_NAME, value: invoicing-worker }
          startupProbe:
            httpGet: { path: /livez, port: 9000 }
            periodSeconds: 2
            failureThreshold: 30
          readinessProbe:
            httpGet: { path: /readyz, port: 9000 }
            periodSeconds: 5
          livenessProbe:
            httpGet: { path: /livez, port: 9000 }
            periodSeconds: 10
            failureThreshold: 3
```
