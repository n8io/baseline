# @n8io/baseline-pulsar

## 1.0.0

### Major Changes

- f9e3433: New package `@n8io/baseline-pulsar`: Events and Consumers on Apache Pulsar 5, sent after the transaction commits, with the queue package's inbox for duplicates. Schedules stay on pg-boss. The queue package now exports `queueJobRun` and `queueRetryLimit`, which the pulsar package shares. The glossary's Event is now delivered once the change that caused it commits.

### Patch Changes

- Updated dependencies [f9e3433]
- Updated dependencies [cbd9f72]
- Updated dependencies [b99f091]
  - @n8io/baseline-queue@2.0.0
  - @n8io/baseline-logger@2.0.0
