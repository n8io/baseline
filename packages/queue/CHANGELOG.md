# @n8io/baseline-queue

## 8.0.0

### Major Changes

- d96b15b: Events are kept in order per Event key, and Consumers fetch them in batches.
  - **Breaking:** `EventsPublisher.publish` takes one object with a required, non-empty `key`: `publish({ name, data, key })`. The key is the Event key, the id of the entity the Event is about. `queueEventsMemoryCreate` records the key too. In a Project, every `publish(name, data)` becomes `publish({ name, data, key })`, and the Domain's `<domain>Events` port and memory state gain `key`.
  - Each Consumer gets the Events of one Event key one at a time, in the order their transactions committed, on any number of workers; other keys run beside them. A worker fetches up to 10 Events at once and runs 4 at a time, and a backlog drains without waiting for a poll (measured: about 1,000 Events a second over 50 keys on 12 workers, about 150 a second on one busy key).
  - An Event that fails all five attempts now stays in its queue for 7 days and holds back its Event key, with a copy in `<queueName>.dead`. `queue.blockedKeys()` lists blocked keys, the worker logs each at error level, and the queue README has the runbook to run the Event again or give it up.
  - A worker that dies mid-Event or mid-Schedule is noticed within 30 to 90 s (it was 15 minutes), and a fetch still running after five minutes has its unfinished Events failed and retried.
  - Upgrading needs no step: Consumer queues move to `<queueName>.ordered`, the old queues are drained during the rollout and removed by a `queueMigrate` a week or more later. See "Upgrading to 8" in the queue README.
  - `events-and-bridges.md` gains the Event key, the ordering guarantee and the rule for changing an Event's shape across a rollout. "Event key" is a glossary term.
- 0029cba: Baseline no longer supports Apache Pulsar. `@n8io/baseline-pulsar` is removed from the repo and gets no further releases; Events run on the queue alone.
  - **Breaking:** queue no longer exports `queueJobRun` or `queueRetryLimit`, which only the pulsar package used.
  - app: `eventsOpen(queue)` in `src/events-open.ts` takes the queue alone, and only the composition roots, `src/authn.ts` and `src/connections.ts` read `#env` (rule A22). The docs drop their Pulsar notes. To upgrade, change `src/events-open.ts` and its call in `src/queue-open.ts` to match, and copy `architecture-test-rules.ts` with `architecture-test-samples/a22-ui-reads-env.txt` together (the A22 message changed). A Project still on Pulsar stays on its pulsar 4.x and this Template's previous release: pulsar 4 works with queue 7 only.
- c12b043: Workers stay up through a Postgres failover, and Schedules are safe in a rolling deploy.
  - **Liveness.** `queue.isAlive()` is false only when the worker's own poll loop hangs. A poll that fails counts as proof the loop runs, so a Postgres outage of any length no longer makes every Worker fail `/livez` and restart together; they carry on by themselves when Postgres is back. A process that cannot reach Postgres at boot still fails and never reports ready.
  - **Breaking:** `queueSchedulesRegister` is replaced by two functions. `queueSchedulesSync({ databaseUrl, schedules, env })` adds, updates and removes Schedules from the migrate entry, once per deploy with the newest code. `queueSchedulesStart({ queue, schedules, env })` runs them in the worker and changes nothing: a Worker of the previous version that boots mid-rollout can no longer remove a new Schedule or put an old cron back. A Schedule the database does not hold is not started and is logged as a warning.
  - `queueCreate` takes `concurrency`: how many Events and Schedule runs a worker has under way at once, across all its Consumers and Schedules (default 4). It was 4 per Consumer, which let a Worker with a few Consumers use up its own pool. An Event or run that the queue has given up, because it hangs, gives its place back.
  - Every worker looks for blocked Event keys once a minute, logs each new one at error level and reports `baseline.queue.blocked_keys` per Consumer, so a key blocked by an Event the queue failed by itself is seen too.
  - Queue errors that pg-boss reports as plain objects are logged as an `Error` with the message, stack and code, and the object as its `cause`, and each queue's failures are logged once per 30 s, so an outage does not log every failed poll. A worker whose queue `queueMigrate` has removed logs one warning and stops polling it, where it used to log an error on every poll.
  - Template: `src/migrate.ts` syncs the Schedules, `src/worker.ts` starts them, and each Domain's `api/<domain>-schedule.ts` exports its name and cron as `<domain>Schedule` beside `<domain>ScheduleCreate`. `src/connections.ts` runs one query at boot, so a Server or Worker that cannot reach Postgres never reports ready. The Worker no longer waits 5 s before it shuts down, since no load balancer sends it traffic, and it runs one Event or Schedule run fewer at once than its pool has connections.

  To upgrade a Project: in each `api/<domain>-schedule.ts` export `<domain>Schedule = { cron, name }` and spread it into `queueScheduleCreate`; export it from `api/index.ts`; in `src/migrate.ts` call `queueSchedulesSync({ databaseUrl, env: ENV, schedules: [...] })` after `queueMigrate`; in `src/worker.ts` rename `queueSchedulesRegister` to `queueSchedulesStart` and set `drainDelayMs: 0`; copy the query in `connectionsOpen` and the `concurrency` line in `src/queue-open.ts`. Run migrate before the new Workers start, as every deploy does, and give migrate the same `SCHEDULE_*` variables as the Worker: the cron overrides now act in migrate, and the Worker reads only `off`.

## 7.0.0

### Major Changes

- bcdb0ce: A function with three or more inputs takes one typed input object, and Biome's `useMaxParams` (max 2) now fails on a third parameter in the packages and the Template. A callback whose shape a library fixes (pino's `logMethod`, the Pulsar client's log, `String.replace`, the `DrizzleQueryError` constructor in a logger test) carries a `biome-ignore` naming that library.

  Breaking changes in the packages, with the new call:
  - `@n8io/baseline-cache`: `CacheStore.set({ json, key, ttlMs })`. A Project's own `CacheStore` changes its `set` the same way. `Cache<T>.set(id, value)` is unchanged.
  - `@n8io/baseline-live/client`: `useLiveUpdates({ channel, id, pathPrefix? })`.
  - `@n8io/baseline-postgres`: `postgresTransactionRun({ pgPool, timeoutMs?, work })`, where a `null` or missing `timeoutMs` means 5 s.
  - `@n8io/baseline-queue`: `queueConsumerCreate({ eventName, queueName, run, schema })`, `queueScheduleCreate({ cron, name, run })`, `queueSchedulesRegister({ env, queue, schedules })` and `queueJobRun({ job, queueName, work })`.

  `@n8io/baseline-authn` and `@n8io/baseline-pulsar` change only inside.

  In the Template, `useLiveUpdates`, `queueScheduleCreate`, `queueSchedulesRegister` and the test helpers move to the object form. A Use case that a Consumer calls takes the `inbox` in its input, `u.invoiceCreate(actor, { amountCents, customerId, inbox })`, so a Use case keeps two parameters. To upgrade a Project: change each call above, including every Domain's `api/<domain>-schedule.ts` (`queueScheduleCreate`), `src/worker.ts` (`queueSchedulesRegister`), each `ui/routes/<domain>-detail.tsx` (`useLiveUpdates`), each `spi/<domain>-transaction.postgres.ts` (`postgresTransactionRun`) and each Consumer and the Use case it calls. Each Domain's tests copied from foo change too: `spi/<domain>-transaction.postgres.test.ts` (`queueConsumerCreate`), `test/integration/<domain>-worker-shutdown.test.ts` (`productionServerWaitFor`), and the local helpers in `api/<domain>-routes.test.ts`, `ui/routes/<domain>-detail.test.ts` and `use-cases/<domain>-stale-archive.test.ts`; then run `pnpm check`, which names any function left with three parameters.

## 6.0.0

### Major Changes

- a61f217: Every handle that must be closed now has `[Symbol.asyncDispose]`, which calls its named close, so `await using` closes it however its block ends: `LiveHub` (`close`), `Queue` (`stop`), `HealthServer` (`close`), `Analytics` (`close`), `Pulsar` (`close`) and `PostgresPool` (`end`; the type is now pg's pool plus `AsyncDisposable`, and `postgresPoolCreate` adds the method to the pool it returns). The named methods stay.

  Breaking for code that builds one of these handles by hand, such as a test fake typed `LiveHub` or `Analytics`, or a raw `pg.Pool` passed where a `PostgresPool` is expected: add `[Symbol.asyncDispose]`, or build the pool with `postgresPoolCreate`.

  In the Template, `docs/agents/using.md` states the rule: use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process.
- 719041e: `queueEventsMemoryCreate` takes one options object: `queueEventsMemoryCreate({ published })`. `published` is optional and so is the whole argument, so `queueEventsMemoryCreate()` still works. A call that passes the array on its own no longer compiles.

  In the Template, `foo-transaction.memory.ts` passes `{ published: pending }`. When you upgrade, make the same change in every Domain's `spi/<domain>-transaction.memory.ts`: `queueEventsMemoryCreate<…>(pending)` becomes `queueEventsMemoryCreate<…>({ published: pending })`.

### Minor Changes

- 94f2893: Four Packages no longer need you to install Zod to use them. You bring the schema library, and each README shows how to pass a Zod schema.
  - `@n8io/baseline-cache` and `@n8io/baseline-queue`: `cacheCreate`'s `schema` and `queueConsumerCreate`'s schema are any [Standard Schema](https://standardschema.dev), so a Zod, Valibot or ArkType schema goes in as it is. Calls that pass a Zod schema do not change. The `zod` peer is gone. A Consumer's validation error now names the paths that failed in its message (`Event failed validation for billing.order-placed at totalCents`) and has no `cause`, so no validator's message can put an Event's values in a log.
  - `@n8io/baseline-id`: `idSchemaCreate` is gone. `idPatternCreate(prefix)` returns the `RegExp` to build an id schema from, in any schema library.
  - `@n8io/baseline-authn`: `Actor` is a type only; the Zod schema of the same name is no longer exported. Zod is the package's own dependency now, not a peer.

  `@n8io/baseline-http` keeps its `zod` peer: it is built on `@hono/zod-openapi`.

  In the Template, the new `src/id-schema.ts` exports `idSchemaCreate`, the Zod schema built from `idPatternCreate`. Foo: `models/foo.ts` imports `idSchemaCreate` from `../../../id-schema.ts`, not from `@n8io/baseline-id`, and `ui/routes/foo-detail.tsx` parses the id with `Foo.shape.id`. When you upgrade, change that import in every Domain's `models/<domain>.ts` and anywhere else that imports `idSchemaCreate`.

  This Release is `app@5.0.0`, so it creates the tag `v5`. The Template's `ci.yml` calls `app-ci.yml@v5` and `dependabot-automerge.yml@v5`; `v4` stays frozen at `app@4.0.0`.

### Patch Changes

- Updated dependencies [3348934]
  - @n8io/baseline-logger@3.1.0

## 5.0.0

### Major Changes

- ef20aa0: Events go through one `Events` handle, whatever carries them, so moving Events from the queue to Pulsar changes one file in a Project instead of every Domain.

  `@n8io/baseline-queue` exports `Events` (`consumersSubscribe`, `consumersStart`, `publisherCreate(transaction)`, `isAlive`), `EventsPublisher` (`publish`, then `committed()` once the transaction has committed) and `queueEventsCreate(queue)`. `queueEventsPgBossCreate`, `QueueEvents`, `queueConsumersSubscribe` and `queueConsumersStart` are gone. `queueCreate`, `publisherCreate` and `queueInboxInsert` take a `QueueSql` (anything with `query(text, values?)`), so the package no longer has `pg` or `@types/pg` peers.

  `@n8io/baseline-pulsar` exports `pulsarCreate` (its `token` may now be `undefined`) and `pulsarEventsCreate(pulsar)`, which now returns that same `Events`. `PulsarEvents`, `pulsarConsumersSubscribe` and `pulsarConsumersStart` are gone; `send()` is `committed()`.

  In the Template, the new `src/events-open.ts` is the only file that names the transport, and `connectionsOpen` returns it as `connections.events`.

  When you upgrade:
  - In each Domain's `spi/<domain>-transaction.postgres.ts`, take `events: Events` in place of `queue: Queue`, create the publisher with `events.publisherCreate<<Domain>EventMap>(pgClient)`, and call `committed()` on it after `postgresTransactionRun` returns ok. Copy the shape from Foo.
  - In each Domain's `spi/index.ts`, read `connections.events` in place of `connections.queue`.
  - In `src/server.ts`, call `connections.events.consumersSubscribe([...])`. In `src/worker.ts`, call `events.consumersStart([...])` and report `queue.isAlive() && events.isAlive()`.
  - In tests that build a Postgres transaction, pass `queueEventsCreate(queue)`.
  - A Project already on Pulsar moves its client into `src/events-open.ts` as the pulsar README shows, and drops its other Pulsar wiring.

### Minor Changes

- 867f91e: Vendor-only settings have one way in. `postgresPoolCreate`, `postgresMigrate`, `queueCreate`, `queueMigrate`, `pulsarCreate` and `analyticsMixpanelCreate` take a `vendor` option, typed as the vendor's own settings and passed through: `ssl` for Postgres, pg-boss's tuning, OAuth2 or mTLS for Pulsar, Mixpanel's `host` for data residency. A Package's named options win, and `vendor` throws on the keys they set and on the ones that would do nothing. `vendor` is outside each Package's contract: it is not tested, and a vendor swap deletes it.

  In the Template, `docs/agents/vendor-settings.md` says when to use it, and architecture rule A12 allows the vendor factories only in `src/connections.ts`, `src/redis.ts` and the `src/*-open.ts` files.

  A factory that is one vendor's takes one options object: `analyticsMixpanelCreate({ token, vendor? })`, `cacheStoreRedisCreate({ redisClient })` and `liveHubRedisCreate({ redisClient })` replace their positional forms. When you upgrade, wrap the argument of those three calls.

### Patch Changes

- Updated dependencies [d63058e]
  - @n8io/baseline-logger@3.0.0

## 4.0.0

### Major Changes

- 1cc11af: Exports follow the full naming rule: factories end in `Create`, predicates end in `Is`, `Has` or `Can`, and every export starts with its package's name. No old names remain as aliases. Rename these imports:
  - authn: `authnRoutes` → `authnRoutesCreate`, `authnMiddleware` → `authnMiddlewareCreate`.
  - http: `httpErrorResponses` → `httpErrorResponsesCreate`, `httpErrorBody` → `httpErrorBodyCreate`, `httpProblemSchema` → `httpProblemSchemaCreate`.
  - id: `idSchema` → `idSchemaCreate`.
  - postgres: `postgresIdColumn` → `postgresIdColumnCreate`, `postgresTransaction` → `postgresTransactionRun`, `postgresUniqueViolation` → `postgresUniqueViolationIs`.
  - queue: `consumerCreate` → `queueConsumerCreate`, `consumersStart` → `queueConsumersStart`, `consumersSubscribe` → `queueConsumersSubscribe`, `scheduleCreate` → `queueScheduleCreate`, `schedulesRegister` → `queueSchedulesRegister`.
  - shutdown: `shutdownHandle` → `shutdownHandleCreate`.

### Patch Changes

- 5985c99: Docs match the code: the telemetry README shows the one preload file the Template uses (no `--experimental-loader`), the result README shows errors as `Error` subclasses with a `type` field, the queue Consumer example passes a machine Actor, the glossary adds Inbox and Repository, and `grafana/otel-lgtm` is pinned to a version tag.
- Updated dependencies [5985c99]
  - @n8io/baseline-result@1.1.1

## 3.0.0

### Major Changes

- 5467b94: Factories that build and return a thing now end in `Create`: `cacheMemory` is `cacheMemoryCreate`, `cacheRedis` is `cacheRedisCreate`, `queueEventsMemory` is `queueEventsMemoryCreate`, `queueEventsPgBoss` is `queueEventsPgBossCreate` and `pulsarEvents` is `pulsarEventsCreate`. There are no deprecated aliases; rename the imports.

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-logger@2.1.0
  - @n8io/baseline-result@1.1.0

## 2.0.0

### Major Changes

- cbd9f72: `queueStop` is gone: call `queue.stop()`. `schedulesRegister` takes the composition root's `ENV` (any object; an item that is not a string is no override), so the Worker no longer reads `process.env`. The shutdown package no longer exports the `ShutdownOptions` type; server.ts and worker.ts use `ShutdownHandle`. The postgres and queue tests share one Postgres test setup in `test/postgres/`.

### Minor Changes

- f9e3433: New package `@n8io/baseline-pulsar`: Events and Consumers on Apache Pulsar 5, sent after the transaction commits, with the queue package's inbox for duplicates. Schedules stay on pg-boss. The queue package now exports `queueJobRun` and `queueRetryLimit`, which the pulsar package shares. The glossary's Event is now delivered once the change that caused it commits.

### Patch Changes

- Updated dependencies [b99f091]
  - @n8io/baseline-logger@2.0.0

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-logger@1.0.0
  - @n8io/baseline-result@1.0.0
