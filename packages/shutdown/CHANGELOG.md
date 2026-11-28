# @n8io/baseline-shutdown

## 3.4.1

### Patch Changes

- 126f764: The package's logger is now built on its first use, not when the module loads, so a bad `LOG_LEVEL` no longer throws at import. The same `TypeError` is thrown by the first call that needs the logger.
- 6b596a6: The package's default logger now comes from `@n8io/baseline-logger`'s `loggerDefaultCreate`. Behaviour is unchanged: the logger is built on its first use, and a bad `LOG_LEVEL` throws the same `TypeError` there.
- Updated dependencies [8a03afb]
- Updated dependencies [b3a3a95]
- Updated dependencies [6b596a6]
- Updated dependencies [39c8e87]
  - @n8io/baseline-shared@0.1.2
  - @n8io/baseline-logger@4.1.0

## 3.4.0

### Minor Changes

- c38b1ad: `shutdownHandleCreate` takes `host.logger` and `errorTrackingSentryCreate` takes `logger`, each defaulting to the Package logger, so a test passes a plain object instead of reassigning a method of the logger.

### Patch Changes

- 0202e13: `sharedTimeRace` and `sharedTimeLimit` now wait the full duration for a delay over 2147483647 ms (they fired after about 1 ms), and `sharedTimeTimer` is new. Shutdown clears its default timers when a run ends. `queueMigrate` still waits as long as pg-boss's index builds take; a new optional `indexesDeadlineMs` makes it throw after that many ms, and sets no limit by default. `analyticsLoggerCreate` takes a `logger` option.
- Updated dependencies [0202e13]
- Updated dependencies [f89d502]
  - @n8io/baseline-shared@0.1.1
  - @n8io/baseline-logger@4.0.0

## 3.3.0

### Minor Changes

- da3de3f: Add a `host` option to `shutdownHandle` (`exit`, `on` and `sleep`, default the real `process.exit`, `process.on` and `setTimeout`), so a test drives a shutdown without fake timers. Exports `ShutdownHost`.

### Patch Changes

- 64b75db: Share the helpers the Packages each wrote their own copy of, through the new `@n8io/baseline-shared`.
  - shared: new Package with the timeout race (`sharedTimeLimit`, `sharedTimeRace`), the integer option check (`sharedIntegerAssert`), the 2147483647 timer limit, the server keep-alive timeouts and the Postgres connection checks. It has no dependencies and is for the Packages, not for a Project.
  - redis, cache, live, feature-flags: use the one timeout race instead of six hand-written ones.
  - cache, feature-flags, health, queue, postgres, shutdown, sdk: option errors now come from one formatter, so a bad number reads `<function>: <option> must be a whole number from 1 to N, found X` (or `, N or more`); the same inputs still throw a `TypeError`.
  - health, http: one owner for the 65 s keep-alive; `httpServerKeepAlive` is unchanged.
  - queue, postgres: one copy of the Postgres URL and TLS checks.
  - sdk: ky does the waiting on `Retry-After` and rate-limit headers; the hand-written backoff and header parsing are gone. A wait that runs past `totalTimeoutMs` now ends in the `TimeoutError` instead of resolving the 429 or 503 at once.
- Updated dependencies [64b75db]
  - @n8io/baseline-shared@0.1.0

## 3.2.0

### Minor Changes

- d5953b6: shutdownHandleCreate refuses a `deadlineMs` above 2147483647 (what a timer can hold), and its messages end `found X`. README: the shutdown steps have their own fold.
- 3e45f69: Exported types and functions take and return readonly arrays (intakes, resources), so a caller's array is never edited and an array a Package returns cannot be. A mutable array a caller passes in still compiles; code that edits a returned array, or hands it to a function that wants `T[]`, copies it first.

### Patch Changes

- Updated dependencies [d5953b6]
- Updated dependencies [f0993b4]
  - @n8io/baseline-logger@3.1.3

## 3.1.0

### Minor Changes

- bfb7735: shutdown follows the shared Package rules. `ShutdownOptions` is exported. `deadlineMs` and `drainDelayMs` take `null`, which means the default as leaving them out does. `shutdownHandleCreate` throws a `TypeError` starting `shutdownHandleCreate:` on a `deadlineMs` that is not an integer over 5000, or a `drainDelayMs` that is not a whole number under `deadlineMs` minus 5000: with those, the intake cutoff came at once and every intake was cut. Every export has a doc comment, the body lives in `shutdown-handle.ts`, and the README example reads the Template's `SHUTDOWN_DRAIN_DELAY_MS` and tells a Project how to test around the handle.

### Patch Changes

- 84c85e1: README and doc comment wording: examples show their imports, Exports rows name each export, and glossary words read as the glossary writes them.
- e7bc75a: Internal names and tests tidied; adds the `test:unit` script so root `pnpm test:unit` runs this Package's tests.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
- Updated dependencies [e7bc75a]
- Updated dependencies [bfb7735]
- Updated dependencies [9a5b1a1]
  - @n8io/baseline-logger@3.1.2

## 3.0.2

### Patch Changes

- df8b85a: Rewrite the README: a bold promise, a Guarantees table, a short example, an animated diagram, a testing note and the full reference folded below.
- Updated dependencies [df8b85a]
  - @n8io/baseline-logger@3.1.1

## 3.0.1

### Patch Changes

- Updated dependencies [d63058e]
  - @n8io/baseline-logger@3.0.0

## 3.0.0

### Major Changes

- 1cc11af: Exports follow the full naming rule: factories end in `Create`, predicates end in `Is`, `Has` or `Can`, and every export starts with its package's name. No old names remain as aliases. Rename these imports:
  - authn: `authnRoutes` → `authnRoutesCreate`, `authnMiddleware` → `authnMiddlewareCreate`.
  - http: `httpErrorResponses` → `httpErrorResponsesCreate`, `httpErrorBody` → `httpErrorBodyCreate`, `httpProblemSchema` → `httpProblemSchemaCreate`.
  - id: `idSchema` → `idSchemaCreate`.
  - postgres: `postgresIdColumn` → `postgresIdColumnCreate`, `postgresTransaction` → `postgresTransactionRun`, `postgresUniqueViolation` → `postgresUniqueViolationIs`.
  - queue: `consumerCreate` → `queueConsumerCreate`, `consumersStart` → `queueConsumersStart`, `consumersSubscribe` → `queueConsumersSubscribe`, `scheduleCreate` → `queueScheduleCreate`, `schedulesRegister` → `queueSchedulesRegister`.
  - shutdown: `shutdownHandle` → `shutdownHandleCreate`.

## 2.1.0

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-logger@2.1.0

## 2.0.0

### Major Changes

- cbd9f72: `queueStop` is gone: call `queue.stop()`. `schedulesRegister` takes the composition root's `ENV` (any object; an item that is not a string is no override), so the Worker no longer reads `process.env`. The shutdown package no longer exports the `ShutdownOptions` type; server.ts and worker.ts use `ShutdownHandle`. The postgres and queue tests share one Postgres test setup in `test/postgres/`.

### Patch Changes

- Updated dependencies [b99f091]
  - @n8io/baseline-logger@2.0.0

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-logger@1.0.0
