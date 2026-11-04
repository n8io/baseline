# @n8io/baseline-logger

## 2.0.0

### Major Changes

- b99f091: Trim exports nobody imports and the dependencies nobody uses.
  - logger: the root no longer exports `LoggerErr`, `loggerErrSerialize`, `loggerRedactPaths` or `LoggerFields`. Import `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
  - authn: the root no longer exports `AuthnInvalidError`.
  - live: the root no longer exports the `LiveUpdate` type. `liveRedis` now takes the `RedisClient` type and time limit from `@n8io/baseline-cache`.
  - cache: `cacheRedisClientCreate` takes only `{ cacheUrl }`, and the root exports `cacheTimeLimit`.
  - postgres: drops its unused `zod` peer dependency.
  - app: drops the unused `lucide-react` dependency.

## 1.1.0

### Minor Changes

- b8aa31f: Adds the `@n8io/baseline-logger/err-serialize` subpath with `loggerErrSerialize` and `LoggerErr`. Importing it creates no logger and loads no pino, so a preload can serialize errors without loading pino before OpenTelemetry starts.

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.
