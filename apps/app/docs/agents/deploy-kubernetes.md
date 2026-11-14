# Kubernetes

Read when running a Project on Kubernetes or on more than one instance. It is written for up to about 12 pods per role, a highly available Postgres (alone or behind PgBouncer) and a highly available Redis. [deploy.md](deploy.md) holds the rules that apply on any runner.

## Roles

One image, three entries (see the `Dockerfile` header):

- **Server**: a Deployment behind a Service. Serves pages, the API and live updates.
- **Worker**: a Deployment with no Service. Runs Consumers and Schedules.
- **migrate**: a Job, run once per rollout, before any pod of the new version starts. It migrates the tables and the queue, and it alone adds, updates and removes Schedules. Do not make it an init container: a pod of the previous version that restarts mid-rollout would run the old migrate and undo the new Schedules.

Give migrate the same variables as the Worker (put any `SCHEDULE_<NAME>` in the shared Secret or on both): a cron override acts only in migrate, and a Worker reads only `off`. A Worker that logs "Schedule is not in the database" started without a migrate: run it, then restart the Worker.

## Probes

All three probes use `HEALTH_PORT` (9000). A dependency that is down keeps new pods from starting and never restarts a running one.

- **Liveness** (`/livez`) is the process only. The Server always passes. The Worker fails only when its own poll loop has hung for 60 s. Postgres or Redis being down never fails it, so running pods ride out a failover and carry on by themselves.
- **Startup.** The health port opens only after secrets load and the process's connections open, on the Server and the Worker alike, and a Server or Worker that cannot reach Postgres or Redis (the Server: also the identity provider) exits 1 at boot. Until then nothing listens on it, so `/livez` and `/readyz` both fail to connect. A startup probe on `/livez` therefore passes only for a process that got past its Postgres check. So during an outage new pods crash-loop, never become ready, and a rollout stalls with the old pods still serving.
- **Readiness** (`/readyz`) is 200 once the pod has booted and listens, and 503 from SIGTERM on. It does not ask Postgres again on a running pod.

Values: startup `/livez` every 2 s, 30 failures allowed; readiness `/readyz` every 5 s; liveness `/livez` every 10 s, 3 failures. Never add a dependency check to liveness, and keep the pool's query timeout (15 s) well under 60 s: the Worker's rule needs a poll that fails, not one that hangs.

## Pool sizing

Every process opens at most `DATABASE_POOL_MAX` Postgres connections (unset: 10 in a Server, 5 in a Worker). The queue shares that pool. A Worker runs at most pool max minus 1 Events and Schedule runs at once, whatever its number of Consumers, so raise `DATABASE_POOL_MAX` on Workers to run more per pod.

```
(Server pods + surge) x Server max + (Worker pods + surge) x Worker max + 5
    <= max_connections - superuser_reserved_connections
```

The 5 are for migrate (at most 2 at a time) and people. Surge pods count: old and new pods overlap in a rollout. A pod that is shutting down keeps its connections for up to 25 s more, so leave some headroom.

Worked example, 12 pods: 8 Servers and 4 Workers, `maxSurge: 25%` (2 and 1 more), Postgres at `max_connections=100` with 3 reserved, so 97.

- Defaults: 10 x 10 + 5 x 5 + 5 = 130. Too many: Postgres refuses connections.
- `DATABASE_POOL_MAX=6` on Servers and `4` on Workers: 10 x 6 + 5 x 4 + 5 = 85. Fits. Each Worker then runs 3 at once.
- More pods or bigger pools than that: raise `max_connections`, or put PgBouncer in front.

## PgBouncer

- Runtime goes through PgBouncer in transaction mode: requests, Events, Schedules and transactions use nothing a session must keep. That was measured once with Workers and a publisher; no test in the repo covers it. The formula above then counts against PgBouncer's `max_client_conn`, and its `default_pool_size` (one database, one user) plus the 5 must fit under `max_connections`.
- Settings a prod-like compose run used (one database and one user, Servers and Workers sized by the formula above):

  ```
  pool_mode = transaction
  max_prepared_statements = 200
  default_pool_size = 40
  max_client_conn = 200
  reserve_pool_size = 5
  ```

  PgBouncer 1.21 and later tracks prepared statements in transaction mode while `max_prepared_statements` is above 0 (its default was 0 in 1.21 and 1.22, and is 200 since), so keep it above 0 and a driver that prepares a statement keeps working. Take `max_client_conn` from the pool formula above (every pod's `DATABASE_POOL_MAX`, plus surge and migrate), and `default_pool_size` from what Postgres can serve once the 5 for migrate and people are taken off `max_connections`. These are a starting point, not a limit anyone measured.
- A Postgres that hangs or is paused fails a boot within about a second once PgBouncer has seen its login fail (the first boot waits for a timeout): PgBouncer caches the failed login (`server_login_retry`) and answers the next client with that error, not after the 15 s query timeout. New pods crash-loop quickly and no running pod is touched.
- migrate must reach Postgres itself. Set `DATABASE_MIGRATE_URL` to the direct URL on the migrate Job. Without it migrate fails at once with "postgresMigrate needs a direct connection to Postgres", in every pool mode.
- migrate waits 60 s for another migrate, then fails naming its advisory lock. With no other migrate running, a session holds the lock: find it in `pg_locks` (locktype `advisory`) and end it with `pg_terminate_backend`.

## Secrets

`.env.production` holds `op()` references. A variable already set in the environment wins and is never fetched. Two ways to boot:

- **1Password at boot** (a few pods). Set `OP_SERVICE_ACCOUNT_TOKEN` and allow outbound HTTPS to 1Password. Every boot reads every reference, so a crash loop across many pods can use up the service account's read limit (1,000 an hour on 1Password Teams), and then no pod can boot or restart. A 1Password outage blocks scale-up and rescheduling too.
- **Kubernetes Secret** (a fleet). Let External Secrets or the 1Password Operator sync the vault into a Secret whose keys are the names in `.env.production`, and load it with `envFrom`. Set no token: boot never calls 1Password. varlock still checks every value and redacts it in logs.

With no token, a reference that is not set fails the boot with `Invalid env vars: <NAME>`. A changed secret reaches a pod only when it restarts, either way.

## Graceful shutdown

Set `terminationGracePeriodSeconds: 30`. The process ends itself within 25 s of SIGTERM and needs no `preStop` hook.

- Server: `/readyz` turns 503 and it keeps serving for `SHUTDOWN_DRAIN_DELAY_MS` (5 s when unset) while the Service drops the pod, then finishes open requests and closes live streams (to second 20 at most), then closes its connections.
- Worker: stops fetching at once and gives running Events and Schedule runs 15 s. One still running after that is failed and retried after the usual wait (10 s or more), and that counts as one of its five attempts. A Worker that is killed is noticed within 30 to 90 s. So keep a Consumer short and safe to run twice (the Inbox).

## Load balancer

- A plain load balancer (HAProxy, a cloud target group, compose) that has no startup probe checks `/readyz` on the health port (`HEALTH_PORT`, 9000), not on the app's port: 1 s interval, one failure takes a pod out, two passes bring it back. `/readyz` turns 503 the moment SIGTERM arrives, which is how the pod leaves before it stops serving.
- Keep the ingress's or load balancer's idle (keep-alive) timeout under 65 s, the time the Server keeps an idle connection. Longer brings 502s on reused connections.
- Anything caching in front of the app must honour `cache-control: no-store` on a 404 under `/assets/`. Never cache 404s by default.

## Sign-in without an identity provider

The memory issuer (`AUTHN_ISSUER_URL=memory://`) is for development and test: `APP_ENV` must be `development` or `test`, and production refuses to boot with it. Its tokens are signed with a key derived from `AUTHN_SECRET`, so every Server that shares the secret accepts them, and a session started at one refreshes at the next: a prod-like stack of several Servers behind a load balancer needs no sticky sessions. The drain does not depend on `APP_ENV`: `.env.development` and `.env.test` set `SHUTDOWN_DRAIN_DELAY_MS=0`, so a prod-like run sets it to 5000, the timing production gets when it is unset. Sign-in cookies carry the `__Host-` prefix, so open the stack at `http://localhost:<port>`, not at `127.0.0.1` or a LAN name. See [authn.md](authn.md).

## Rolling deploys

Old and new pods run side by side for minutes. Use `maxUnavailable: 0` on the Server.

- **Tables** change by expand, then contract ([data.md](data.md)).
- **Event shapes** change in three releases: widen, switch, narrow. One release is enough to add an optional field ([events.md](events.md)).
- **UI assets.** A page can get its `/assets/` files from a pod of the other version. The app answers such a miss with an uncached 404 and the page reloads itself once, which fixes most page views, not all. To close the window choose one: serve `/assets/` from shared storage or a CDN that keeps the previous build's files beside the new ones (upload `build/client/assets` before the rollout, keep old files a day), or cookie-based session affinity at the ingress, so one browser stays on one version.
- **Rollback.** A release that moved Events to ordered queues (`@n8io/baseline-queue` 8) rolls out with no manual step, but do not roll back across it after a week: by then migrate has removed the old queues and the old release's publishes would be lost silently.

## Redis outage

A Redis outage or failover fails no request.

- Cached reads become database reads. Each cache call waits up to 1 s for Redis, so a cached read can wait up to 2 s (before and after the database read) and a write that clears the cache up to 1 s. Postgres takes more load until Redis is back.
- Live updates sent meanwhile are lost. Open pages catch up within 5 s of Redis returning, without a reload.
- After a write whose cache clear was lost, other pods may serve the old value until its entry expires: 60 s by default. For a value that cannot be that stale, shorten `ttlMs` or do not cache it.
- A new pod still needs Redis to boot.

## Event order

Events with the same Event key run one at a time, in commit order, on any number of Workers. Other Event keys run beside them.

An Event that fails five times stays failed and blocks its Event key; other keys carry on. Decide within 7 days: after that it is deleted and the key moves on without it. `queue.blockedKeys()` lists what is blocked, and the runbook (run it again, or give it up) is "A blocked key" in the `@n8io/baseline-queue` README.

## Redis high availability

`src/redis-open.ts` opens one connection to one URL with `redisClientCreate` from `@n8io/baseline-redis`. That fits an endpoint that follows the primary: a managed highly available Redis, or a proxy in front of Sentinel. Use `rediss://` for TLS. After a drop it reconnects by itself, every 100 ms at first, slowing to every 2 s, and never gives up.

Sentinel or Cluster addressed directly needs node-redis's `createSentinel` or `createCluster` in that one file instead (`pnpm add redis` first; the Template does not depend on it), with your own `error` listener, and the `RedisClient` types in `src/redis-open.ts`, `src/cache-store-open.ts` and `src/live-hub-open.ts` widened to that client. The cache and live updates take either client, but nothing tests that path.

## Alerts

- `baseline.queue.blocked_keys` above 0, as the maximum across pods, never the sum. Log: "Event key is blocked until released".
- `baseline.cache.store_errors` and `baseline.live.sends_failed` rising: Redis is down. One warning per 30 s per cache or hub on each pod, not one per call.
- "Queue error", once per 30 s per queue per pod: Postgres is down.
- `baseline.queue.dead_letters`, or an error log that names "dead letter": an Event or a Schedule run used up its attempts. "Job failed; will retry" is only one failed attempt.

## Known gaps

- During a Redis outage every cache call waits up to 1 s, so a cached read can take up to 2 s longer.
- Without shared assets or session affinity, one reload does not always fix a page of mixed versions.
- A query timeout (15 s) rejects in the app and closes the connection. It does not cancel the statement, which Postgres may still finish.
- Readiness does not check dependencies on a running pod, and nothing logs that Postgres is back.
- A Worker that started before migrate added a Schedule runs it only after a restart.
- One Consumer whose poll loop hangs is hidden from liveness while the Worker's other loops turn.
- Inbox pruning does not count toward a Worker's limit of runs at once.

## Deferred

- Rotating `AUTHN_SECRET` signs everyone out: sign-in cookies are read with one key only.
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
