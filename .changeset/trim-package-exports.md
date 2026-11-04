---
"@n8io/baseline-authn": major
"@n8io/baseline-cache": major
"@n8io/baseline-live": major
"@n8io/baseline-logger": major
"@n8io/baseline-postgres": patch
"app": patch
---

Trim exports nobody imports and the dependencies nobody uses.

- logger: the root no longer exports `LoggerErr`, `loggerErrSerialize`, `loggerRedactPaths` or `LoggerFields`. Import `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
- authn: the root no longer exports `AuthnInvalidError`.
- live: the root no longer exports the `LiveUpdate` type. `liveRedis` now takes the `RedisClient` type and time limit from `@n8io/baseline-cache`.
- cache: `cacheRedisClientCreate` takes only `{ cacheUrl }`, and the root exports `cacheTimeLimit`.
- postgres: drops its unused `zod` peer dependency.
- app: drops the unused `lucide-react` dependency.
