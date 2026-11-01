# Message bus and queue options for the template

Research for [#30](https://github.com/n8io/baseline/issues/30). Feeds [#31](https://github.com/n8io/baseline/issues/31), [#32](https://github.com/n8io/baseline/issues/32) and [#33](https://github.com/n8io/baseline/issues/33). Researched 2026-11-01.

Evidence is tagged:

- **[source]** read in the owner's docs, source code or release notes.
- **[tested]** I ran it on Node 26.10.0 (native TypeScript, no build step) against `postgres:18` (18.6) and `redis:8`. Code is in [`message-bus/`](message-bus/); output is in [`message-bus/results/`](message-bus/results/).
- **[inferred]** reasoned from the above, not run.

## Short answer

Support **pg-boss 12 on the existing Postgres** first, behind our own ports. Do not add Redis queues or a broker in the first version.

pg-boss is the only candidate that does every item in the ticket with no code from us and no new infrastructure:

1. **Outbox for free.** `send()` and `publish()` take a `db` option. Passing the `pg` client from our `postgresTransaction` writes the job in the same transaction as the domain's rows. A rollback leaves no job. [tested]
2. **At-least-once, retries, dead letters.** `retryLimit`, `retryDelay`, `retryBackoff`, and `deadLetter` per queue. [tested]
3. **Delayed and scheduled jobs.** `startAfter` for delay. `schedule()` takes cron or RRULE, and with two instances running it made exactly one job per minute. [tested]
4. **Fan-out across domains.** `subscribe(event, queue)` plus `publish(event)` writes one job per subscribed queue, and it also works inside our transaction. [tested]
5. **Trace context.** Built-in OTel spans and metrics on the messaging semantic conventions. With `propagateContext: true`, the consumer's span joined the producer's trace. [tested]
6. **Graceful shutdown.** `stop({ graceful: true, timeout })` stops fetching and waits for in-flight handlers. [tested]
7. **Weight.** 8 new packages; `pg` and `@opentelemetry/api` are already in the template. [tested]

The `Actor` travels in the message body (it worked as plain data [tested]). The `memory://` adapter is our own small in-memory class behind the port, as for the database and cache ports. pg-boss is never imported by a domain.

## Comparison

| | pg-boss 12 | graphile-worker 0.18 | `SKIP LOCKED` table (our code) | BullMQ 6 | Redis Streams (our code) | NATS JetStream / RabbitMQ / SQS |
| --- | --- | --- | --- | --- | --- | --- |
| New infrastructure | none | none | none | Redis with `noeviction`, or its new Postgres backend | Redis with `noeviction` | a broker |
| Enqueue in our Postgres transaction | yes, `db` option [tested] | yes, `add_job` SQL function [source] | yes | **no** [tested] | no | no |
| Retries | yes [tested] | yes, exponential, 25 attempts default [source] | write it | yes [tested] | write it (`XCLAIM`) | yes |
| Dead-letter queue | yes [tested] | no; failed jobs stay in the table [source] | write it | no; jobs end in a `failed` set [tested] | write it | yes (SQS redrive, RabbitMQ DLX); JetStream only advisories |
| Delayed jobs | yes [tested] | yes [source] | write it | yes [source] | write it | SQS up to 15 min; RabbitMQ's delay plugin is archived; JetStream schedules since 2.12 |
| Cron, once across instances | yes [tested] | yes, `crontab` file [source] | write it | yes, job schedulers [source] | write it | SQS needs EventBridge |
| Fan-out | `publish`/`subscribe` [tested] | no | write it | no (one queue per consumer, producer adds to each) | consumer groups | yes |
| OTel built in | yes, peer `@opentelemetry/api` [source][tested] | no [source] | write it | via extra `bullmq-otel` [source] | write it | in each client, varies |
| Graceful stop | yes [tested] | yes, but it installs its own signal handlers [source] | write it | `worker.close()` [tested] | write it | yes |
| Crash recovery | heartbeat or expiry [source] | jobs locked 4 hours unless you buy Worker Pro [source] | write it | stalled-job check [source] | `XAUTOCLAIM` | broker redelivers |
| New packages (beyond `pg`, OTel API) | 8 | 67 | 0 | 10, plus `bullmq-otel` | 0 | 0 to 24 |
| Weekly downloads | 4.2 M | 1.1 M | n/a | 13.2 M | n/a | amqplib 4.3 M, SQS client 19 M, `@nats-io/jetstream` 0.8 M |

Downloads are npm's last-week counts on 2026-11-01. Package counts are `npm ls --all` on a clean install.

## Each option

### pg-boss 12 (recommended)

- **Version and upkeep.** 12.38.0, published 2026-10-13. One major a year (10.0 in 2024-08, 11.0 in 2025-09, 12.0 in 2025-11) and 77 minors in 12.x. MIT. Requires Node 22.12+ and Postgres 13+. [source: [npm](https://www.npmjs.com/package/pg-boss), [README](https://github.com/timgit/pg-boss#requirements)]
- **Outbox.** The docs say every `send()`, `insert()`, `fetch()` and `complete()` takes `db`, an object with `executeSql(text, values)`. "If the transaction rolls back, so does the job." [source: [adapters](https://github.com/timgit/pg-boss/blob/master/docs/api/adapters.md)] I wrapped a plain `pg.PoolClient` (the same thing `postgresTransaction` holds) and ran one transaction that rolled back and one that committed. Only the committed job exists. [tested: `outboxJobsAfterRollbackAndCommit: ["commit"]`]
- **Transactional worker.** `work(name, { transactional: true }, (jobs, tx) => …)` commits the handler's writes and the job's completion together. It holds a pool connection for the handler's whole run and sets `transaction_timeout` on Postgres 17+. [source: [workers](https://github.com/timgit/pg-boss/blob/master/docs/api/workers.md)] Not tested. It overlaps with our own transaction port, so #31 should decide whether consumers use it or stay idempotent.
- **Retries and dead letters.** A queue with `retryLimit: 2, deadLetter: "foo-dlq"` ran the handler 3 times, then copied the job to `foo-dlq` with `source_name` set. [tested] `redrive()` moves dead letters back. [source: [queues](https://github.com/timgit/pg-boss/blob/master/docs/api/queues.md)]
- **Delay.** `startAfter: 2` ran 2.02 s later. [tested]
- **Schedules.** Cron or RRULE, checked every 30 s, at most one job per minute; "throttling options are then used to make sure only 1 job is sent even if multiple instances are running." A `missed: 'once'` policy catches up one run after an outage. [source: [scheduling](https://github.com/timgit/pg-boss/blob/master/docs/api/scheduling.md)] Two instances with the same `* * * * *` schedule, driven by pg-boss's `TestClock` for 5 minutes, produced one job in each of the 6 minutes. [tested]
- **Fan-out.** `subscribe("foo.created", "bar-foo-created")` and the same for `baz`, then `publish("foo.created", …, { db })` inside our transaction, wrote one job to each queue. [tested] The docs warn that outside a caller's transaction a partial failure can duplicate on retry. [source: [pubsub](https://github.com/timgit/pg-boss/blob/master/docs/api/pubsub.md)] Inside our transaction it is all or nothing. [inferred]
- **Telemetry.** Spans `send {queue}`, `publish {event}`, `process {queue}`, `complete`/`fail`, and metrics `messaging.client.sent.messages`, `messaging.process.duration`, `pgboss.queue.jobs`. `propagateContext` is off by default; when on, it stores `traceparent` (and baggage, unless you pass `W3CTraceContextPropagator`) in a `trace_context` column, kept across retries and dead letters. [source: [opentelemetry](https://github.com/timgit/pg-boss/blob/master/docs/opentelemetry.md)] With it on, the stored `traceparent` carried the producer's trace id and the consumer's active span had the same trace id. [tested] Passing `W3CTraceContextPropagator` keeps baggage out of the table, which fits [#29](https://github.com/n8io/baseline/issues/29). [inferred]
- **Shutdown.** `stop()` "will gracefully wait for all workers to finish processing active jobs", default `timeout` 30 000 ms; a job still being claimed when time runs out is failed and retried. [source: [ops](https://github.com/timgit/pg-boss/blob/master/docs/api/ops.md)] A 3 s handler in flight: `stop()` resolved after 3.02 s, the handler had finished, and the job was `completed`. [tested] The default 30 s is longer than #24's 25 s deadline, so the template must pass a smaller `timeout`. [inferred]
- **Migrations.** `start()` installs and migrates its schema unless `migrate: false`; then it throws if migrations are pending. A CLI (`pg-boss migrate`, `pg-boss plans`) runs or prints them. [source: [constructor](https://github.com/timgit/pg-boss/blob/master/docs/api/constructor.md), [cli](https://github.com/timgit/pg-boss/blob/master/docs/cli.md)] #27 says no migrations at startup, so the app uses `migrate: false` and `src/migrate.ts` runs pg-boss's migration. [inferred]
- **Tests.** `__test__enableSpies` gives `waitForJob`, and `TestClock` moves both JS time and the database's `job_now()`. It also runs on PGlite in-process. [source: [testing](https://github.com/timgit/pg-boss/blob/master/docs/api/testing.md), [database backends](https://github.com/timgit/pg-boss/blob/master/docs/database-backends.md)] One finding: the spy did not see the dead-letter copy pg-boss makes itself, so that test polls the table. [tested]
- **Weight.** Runtime deps `pg`, `cron-parser`, `rrule-temporal`, `serialize-error`; peer `@opentelemetry/api`. 23 packages in all, 8 of them new to the template. [tested]
- **Maintainer.** The README says "It is maintained by one person". `timgit` has 1 669 commits; the next contributor has 106. [source: [README](https://github.com/timgit/pg-boss#sponsors), GitHub contributors API]

### graphile-worker 0.18

- Jobs are added with a SQL function, so they join any transaction. [source: [SQL add_job](https://github.com/graphile/worker/blob/main/website/docs/sql-add-job.md)]
- Still 0.x: "updating to a new minor version (0.y) may require some small code modifications". [source: [project status](https://github.com/graphile/worker/blob/main/website/docs/project-status.md)]
- After a crash, jobs "remain locked for at least 4 hours". Faster recovery is in the paid, closed-source Worker Pro. [source: [error handling](https://github.com/graphile/worker/blob/main/website/docs/error-handling.md), [Pro](https://github.com/graphile/worker/blob/main/website/docs/pro/recovery.md)]
- It handles `SIGTERM` itself, which competes with `@n8io/baseline-shutdown`. No dead-letter queue, no built-in OTel. 67 packages (yargs, cosmiconfig, json5). [source; tested for package count]
- Not tested: it loses to pg-boss on dead letters, crash recovery, telemetry and weight before a test could change that.

### A plain `SKIP LOCKED` table

- Zero dependencies and a perfect outbox. But retries, backoff, dead letters, delay, cron-once-across-instances, heartbeats, fan-out, pruning and spans are all ours to write and test. pg-boss is that code, already written, and itself built on `SKIP LOCKED`. [source: [README](https://github.com/timgit/pg-boss)] Under the few-dependencies rule this is the fallback if pg-boss ever goes unmaintained, not the start. [inferred]

### BullMQ 6 (runner-up)

- The most used Node queue (13.2 M weekly). 6.0.0 (2026-07-30) added pluggable backends: Redis and a new **PostgreSQL** backend, and made `ioredis`, `redis` and `pg` optional peers. [source: [v6.0.0 release](https://github.com/taskforcesh/bullmq/releases/tag/v6.0.0)]
- Works with node-redis (`createNodeRedisClient`), the client the template already has. [tested]
- **No outbox on either backend.** `queue.add()` takes no client; the Postgres backend runs its SQL on its own pool. [source: [`postgres-queue-backend.ts` `addJob`](https://github.com/taskforcesh/bullmq/blob/master/src/postgres/postgres-queue-backend.ts)] I called `add()` between our `BEGIN` and `ROLLBACK`: the job was still there. [tested: `pgJobsAfterOurRollback: 1`] Transactional jobs exist only as a proposal for the Elixir client. [source: [design note](https://github.com/taskforcesh/bullmq/blob/master/elixir/docs/transactional-jobs-design.md)] So #32 would need our own outbox table plus a relay.
- **Redis must not evict.** "very important to configure the `maxmemory-policy` setting to `noeviction`." [source: [going to production](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/going-to-production.md)] The default `redis:8` image is `noeviction` [tested], but a cache Redis is normally set to evict, so sharing `CACHE_URL` is a trap. [inferred]
- The Postgres backend is three months old; the docs say Redis "remains the default and the most battle-tested option". [source: [PostgreSQL guide](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/postgresql.md)]
- Retries ended in `failed` after 3 attempts, no dead-letter queue. `worker.close()` waited for a 3 s handler. [tested] OTel needs the separate `bullmq-otel` package. 402 open issues. [source: npm, GitHub]

### Redis Streams on `CACHE_URL`

- `XADD`, consumer groups, `XACK`, `XAUTOCLAIM` give at-least-once. Everything else (retry counts, dead letters, delay, cron, trace headers) is ours. It shares the eviction problem above and cannot join a Postgres transaction. [source: [Redis Streams docs](https://redis.io/docs/latest/develop/data-types/streams/)] Not tested.

### Brokers: NATS JetStream, RabbitMQ, SQS

- All are good at what they do, and none can join a Postgres transaction, so each needs an outbox table and a relay we write. Each is a second system to run locally and in CI, and none has an in-process mode for unit tests. [inferred]
- RabbitMQ: the delayed-message plugin is archived and "has serious limitations", built on Mnesia, which RabbitMQ 4.3 removed. [source: [plugin repo](https://github.com/rabbitmq/rabbitmq-delayed-message-exchange)] `amqplib` itself has no dependencies.
- NATS JetStream: message schedules (cron, time zones) arrived in server 2.12 and 2.14. [source: [ADR-51](https://github.com/nats-io/nats-architecture-and-design/blob/main/adr/ADR-51.md)] Dead letters are advisories you consume yourself.
- SQS: AWS-only, which the map leaves open (the map stops at a Dockerfile). Delay is capped at 15 minutes; dead letters via a redrive policy. [source: [SQS delay queues](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-delay-queues.html)]
- These are a later adapter behind the same port when a project outgrows Postgres, not the first one. Not tested.

## What this means for the port (input to #31, #32, #33)

[inferred] from the tests above; the tickets decide.

- **Publish is part of the transaction.** The publisher port is handed into the `fooTransaction` callback next to `fooRepository`, so a use case cannot publish outside the transaction. The Postgres adapter calls `boss.publish(event, data, { db })` with the transaction's client. This is the whole outbox; no relay process.
- **Envelope.** `{ actor, …payload }` in the job data. Trace context stays in pg-boss's own column, not in our payload.
- **Consumers are intakes.** `worker.ts` calls `boss.work()` per queue; `shutdownHandle` calls `boss.stop({ graceful: true, timeout })` with a timeout inside the 25 s deadline. Handlers must be safe to redo.
- **Fan-out (#32).** Each consuming domain owns a queue named generic-to-specific (`bar-foo-created`) and subscribes it to the event. No domain imports another.
- **Schedules (#33).** `api/foo-schedule.ts` declares a cron that `boss.schedule()` registers on boot; the job it creates is consumed like any other message, so a schedule is just a producer. Minute granularity only.
- **`memory://`.** An in-memory adapter we write: an array per queue, the same subscribe table, drained by a `memory` worker. The transaction's memory adapter (copy-and-swap) drops its buffered messages on rollback. One contract test per port runs on both.
- **Migrations.** `migrate: false` at runtime; `src/migrate.ts` runs pg-boss's migration in the same job as Drizzle's.

## Strongest case against

pg-boss is one person's project. If its maintainer stops, the template's whole messaging story sits on unmaintained code that owns a schema in every project's database. Mitigations: it has 10 years of releases, an MIT license, and plain SQL tables; the port keeps it out of domains; and a `SKIP LOCKED` adapter of our own is the documented exit. A second case: Postgres becomes the bottleneck for high-volume messaging (BullMQ's own numbers put Postgres at about half Redis's processing rate [source: [PostgreSQL guide](https://github.com/taskforcesh/bullmq/blob/master/docs/gitbook/guide/postgresql.md)]). A project that hits that adds a broker adapter behind the same port.

## Tested vs not

Tested on Node 26.10.0 + Postgres 18.6 (+ Redis 8 for BullMQ):

- pg-boss: outbox rollback/commit with a raw `pg` client, retries to dead letter, fan-out inside a transaction, delay, graceful stop with in-flight work, cron once per minute across two instances, trace id carried producer to consumer, `Actor` in the payload, span names. ([`pgboss-test.ts`](message-bus/pgboss-test.ts), [results](message-bus/results/pgboss-node-26.10.0.txt))
- BullMQ: no transactional enqueue on the Postgres backend, retries end in `failed`, graceful `close()`, node-redis adapter works, `redis:8` default eviction policy. ([`bullmq-test.ts`](message-bus/bullmq-test.ts), [results](message-bus/results/bullmq-node-26.10.0.txt))
- Package counts for all Node clients.

Not tested:

- Type-checking pg-boss's or BullMQ's types under TypeScript 7 native (the scripts ran with Node's type stripping, which does not check types).
- pg-boss's `transactional` worker, `migrate: false` with the CLI, PGlite, and the `pg` "client.query() when the client is already executing a query" deprecation warning seen once in the full run (not reproduced on its own).
- graphile-worker, Redis Streams and the brokers.
- Load or throughput.
