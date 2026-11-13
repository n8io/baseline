# @n8io/baseline-postgres

## 2.0.0

### Major Changes

- 1cc11af: Exports follow the full naming rule: factories end in `Create`, predicates end in `Is`, `Has` or `Can`, and every export starts with its package's name. No old names remain as aliases. Rename these imports:
  - authn: `authnRoutes` → `authnRoutesCreate`, `authnMiddleware` → `authnMiddlewareCreate`.
  - http: `httpErrorResponses` → `httpErrorResponsesCreate`, `httpErrorBody` → `httpErrorBodyCreate`, `httpProblemSchema` → `httpProblemSchemaCreate`.
  - id: `idSchema` → `idSchemaCreate`.
  - postgres: `postgresIdColumn` → `postgresIdColumnCreate`, `postgresTransaction` → `postgresTransactionRun`, `postgresUniqueViolation` → `postgresUniqueViolationIs`.
  - queue: `consumerCreate` → `queueConsumerCreate`, `consumersStart` → `queueConsumersStart`, `consumersSubscribe` → `queueConsumersSubscribe`, `scheduleCreate` → `queueScheduleCreate`, `schedulesRegister` → `queueSchedulesRegister`.
  - shutdown: `shutdownHandle` → `shutdownHandleCreate`.
- 17d5d09: `postgresPortsGuard`, `postgresCursorEncode`, `postgresCursorDecode` and `PostgresCursor` move out of `@n8io/baseline-postgres` into the Template, because the memory adapters use them too and none of them touches Postgres. They are now `transactionPortsGuard` in `src/transaction-ports-guard.ts` and `cursorEncode`, `cursorDecode` and `Cursor` in `src/cursor.ts`. When you upgrade, copy both files from the Template. In each Domain's `spi/*-transaction.memory.ts` and `spi/*-transaction.postgres.ts`, import `transactionPortsGuard` from `../../../transaction-ports-guard.ts`; in `spi/*-repository.memory.ts` and `spi/*-repository.postgres.ts`, import `cursorEncode` and `cursorDecode` from `../../../cursor.ts`.

### Patch Changes

- Updated dependencies [5985c99]
- Updated dependencies [1cc11af]
  - @n8io/baseline-result@1.1.1
  - @n8io/baseline-id@2.0.0

## 1.2.0

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-id@1.1.0
  - @n8io/baseline-logger@2.1.0
  - @n8io/baseline-result@1.1.0

## 1.1.0

### Minor Changes

- f6ad1f1: Add `postgresPortsGuard` and `postgresCursorEncode`/`postgresCursorDecode` (generic over the id prefix). The Foo SPI imports them instead of keeping its own `foo-ports-guard.ts` and `foo-cursor.ts`, so a new Domain no longer copies them.

### Patch Changes

- b99f091: Trim exports nobody imports and the dependencies nobody uses.
  - logger: the root no longer exports `LoggerErr`, `loggerErrSerialize`, `loggerRedactPaths` or `LoggerFields`. Import `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
  - authn: the root no longer exports `AuthnInvalidError`.
  - live: the root no longer exports the `LiveUpdate` type. `liveRedis` now takes the `RedisClient` type and time limit from `@n8io/baseline-cache`.
  - cache: `cacheRedisClientCreate` takes only `{ cacheUrl }`, and the root exports `cacheTimeLimit`.
  - postgres: drops its unused `zod` peer dependency.
  - app: drops the unused `lucide-react` dependency.
- Updated dependencies [b99f091]
  - @n8io/baseline-logger@2.0.0

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-id@1.0.0
  - @n8io/baseline-logger@1.0.0
  - @n8io/baseline-result@1.0.0
