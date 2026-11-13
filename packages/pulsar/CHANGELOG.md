# @n8io/baseline-pulsar

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
