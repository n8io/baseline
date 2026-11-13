# @n8io/baseline-pulsar

## 4.0.1

### Patch Changes

- bcdb0ce: A function with three or more inputs takes one typed input object, and Biome's `useMaxParams` (max 2) now fails on a third parameter in the packages and the Template. A callback whose shape a library fixes (pino's `logMethod`, the Pulsar client's log, `String.replace`, the `DrizzleQueryError` constructor in a logger test) carries a `biome-ignore` naming that library.

  Breaking changes in the packages, with the new call:
  - `@n8io/baseline-cache`: `CacheStore.set({ json, key, ttlMs })`. A Project's own `CacheStore` changes its `set` the same way. `Cache<T>.set(id, value)` is unchanged.
  - `@n8io/baseline-live/client`: `useLiveUpdates({ channel, id, pathPrefix? })`.
  - `@n8io/baseline-postgres`: `postgresTransactionRun({ pgPool, timeoutMs?, work })`, where a `null` or missing `timeoutMs` means 5 s.
  - `@n8io/baseline-queue`: `queueConsumerCreate({ eventName, queueName, run, schema })`, `queueScheduleCreate({ cron, name, run })`, `queueSchedulesRegister({ env, queue, schedules })` and `queueJobRun({ job, queueName, work })`.

  `@n8io/baseline-authn` and `@n8io/baseline-pulsar` change only inside.

  In the Template, `useLiveUpdates`, `queueScheduleCreate`, `queueSchedulesRegister` and the test helpers move to the object form. A Use case that a Consumer calls takes the `inbox` in its input, `u.invoiceCreate(actor, { amountCents, customerId, inbox })`, so a Use case keeps two parameters. To upgrade a Project: change each call above, including every Domain's `api/<domain>-schedule.ts` (`queueScheduleCreate`), `src/worker.ts` (`queueSchedulesRegister`), each `ui/routes/<domain>-detail.tsx` (`useLiveUpdates`), each `spi/<domain>-transaction.postgres.ts` (`postgresTransactionRun`) and each Consumer and the Use case it calls. Each Domain's tests copied from foo change too: `spi/<domain>-transaction.postgres.test.ts` (`queueConsumerCreate`), `test/integration/<domain>-worker-shutdown.test.ts` (`productionServerWaitFor`), and the local helpers in `api/<domain>-routes.test.ts`, `ui/routes/<domain>-detail.test.ts` and `use-cases/<domain>-stale-archive.test.ts`; then run `pnpm check`, which names any function left with three parameters.
- 3695b6e: The Template's wiring functions each take one input object: `connectionsOpen({ role })`, `redisOpen({ steps, url })`, `redisClientCreate({ url })`, `cacheStoreOpen({ redis })`, `liveHubOpen({ redis, steps })`, `queueOpen({ database, intakes, resources, role })`, `analyticsOpen({ steps, token })` and `errorTrackingOpen({ dsn, environment, steps })`. `src/connections.ts` now reads `ENV` from `#env` itself (rule A22 allows it, and `src/events-open.ts`, where the Pulsar guide reads `PULSAR_URL`), so a call site passes only the role. `queueOpen` returns `{ events, queue }` and calls `eventsOpen` only once the queue is real, so `eventsOpen` takes a `Queue` and returns `Events`; the Pulsar guide shows the new shape.

  To upgrade, change every `connectionsOpen(ENV, "publisher")` to `connectionsOpen({ role: "publisher" })` (and `"worker"` likewise), and drop the `ENV` import where nothing else uses it. Each Domain's copied tests call it: `spi/index.test.ts`, `spi/index-queue.test.ts`, `api/<domain>-live.test.ts`, `ui/routes/<domain>-list.test.ts` and `ui/routes/<domain>-detail.test.ts`. Change any call of the other functions above in the Project's own code to the object form. A Project with its own `src/events-open.ts` changes its `queue` type to `Queue` and its return type to `Events`.

  `env-files.test.ts` checks `.env.development` and `.env.test` with `varlock load` itself instead of a hand-written parser of `.env.schema` decorators, so it now also checks each value's type. It reads only the committed files, never a `.local` one. Undeclared items and plain values in `.env.production` are still refused. The Template's piece markers are down from 87 to 82, and a root test keeps them at 91 or fewer, 6 per file (7 in `src/connections.ts`).

  The Template's CI now calls `app-ci.yml@v6`.
- Updated dependencies [bcdb0ce]
  - @n8io/baseline-queue@7.0.0

## 4.0.0

### Major Changes

- a61f217: Every handle that must be closed now has `[Symbol.asyncDispose]`, which calls its named close, so `await using` closes it however its block ends: `LiveHub` (`close`), `Queue` (`stop`), `HealthServer` (`close`), `Analytics` (`close`), `Pulsar` (`close`) and `PostgresPool` (`end`; the type is now pg's pool plus `AsyncDisposable`, and `postgresPoolCreate` adds the method to the pool it returns). The named methods stay.

  Breaking for code that builds one of these handles by hand, such as a test fake typed `LiveHub` or `Analytics`, or a raw `pg.Pool` passed where a `PostgresPool` is expected: add `[Symbol.asyncDispose]`, or build the pool with `postgresPoolCreate`.

  In the Template, `docs/agents/using.md` states the rule: use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process.

### Patch Changes

- Updated dependencies [3348934]
- Updated dependencies [a61f217]
- Updated dependencies [719041e]
- Updated dependencies [94f2893]
  - @n8io/baseline-logger@3.1.0
  - @n8io/baseline-queue@6.0.0

## 3.0.0

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

- Updated dependencies [ef20aa0]
- Updated dependencies [d63058e]
- Updated dependencies [867f91e]
  - @n8io/baseline-queue@5.0.0
  - @n8io/baseline-logger@3.0.0

## 2.1.0

### Minor Changes

- a89218f: Count Events whose send fails after the commit on the `baseline.pulsar.events_lost` counter, with `messaging.destination.name` as its only attribute, so a lost Event can be alerted on.

### Patch Changes

- Updated dependencies [5985c99]
- Updated dependencies [1cc11af]
  - @n8io/baseline-queue@4.0.0

## 2.0.0

### Major Changes

- 5467b94: Factories that build and return a thing now end in `Create`: `cacheMemory` is `cacheMemoryCreate`, `cacheRedis` is `cacheRedisCreate`, `queueEventsMemory` is `queueEventsMemoryCreate`, `queueEventsPgBoss` is `queueEventsPgBossCreate` and `pulsarEvents` is `pulsarEventsCreate`. There are no deprecated aliases; rename the imports.

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [5467b94]
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-queue@3.0.0
  - @n8io/baseline-logger@2.1.0

## 1.0.0

### Major Changes

- f9e3433: New package `@n8io/baseline-pulsar`: Events and Consumers on Apache Pulsar 5, sent after the transaction commits, with the queue package's inbox for duplicates. Schedules stay on pg-boss. The queue package now exports `queueJobRun` and `queueRetryLimit`, which the pulsar package shares. The glossary's Event is now delivered once the change that caused it commits.

### Patch Changes

- Updated dependencies [f9e3433]
- Updated dependencies [cbd9f72]
- Updated dependencies [b99f091]
  - @n8io/baseline-queue@2.0.0
  - @n8io/baseline-logger@2.0.0
