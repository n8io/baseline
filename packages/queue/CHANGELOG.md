# @n8io/baseline-queue

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
