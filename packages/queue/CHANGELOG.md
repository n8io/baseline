# @n8io/baseline-queue

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
