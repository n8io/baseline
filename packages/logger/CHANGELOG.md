# @n8io/baseline-logger

## 4.0.0

### Major Changes

- f89d502: Replaces the module-level `logger` export with `loggerCreate({ level })`, which returns a logger and validates the level (default `LOG_LEVEL`, then `info`) when called. A bad `LOG_LEVEL` now fails at startup, where the caller calls `loggerCreate`, with a `TypeError` naming the valid levels; importing the Package never throws. The old `logger` export is removed, so this is breaking: replace `import { logger }` with a `loggerCreate()` call.

## 3.1.3

### Patch Changes

- d5953b6: The `LOG_LEVEL` message ends `found "<level>"`. README: the `/err-serialize` row starts with its entry.
- f0993b4: Read index-signature properties with bracket access, which the stricter noPropertyAccessFromIndexSignature compiler flag requires. No behavior change.

## 3.1.2

### Patch Changes

- e7bc75a: An invalid `LOG_LEVEL` throws `TypeError` naming the variable and the allowed levels, instead of pino's own message. Adds the `test:unit` script.
- bfb7735: logger follows the shared Package rules: every export has a doc comment, the body lives in `logger.ts`, and the README drops error-tracking's diagram and tells a Project how to test code that logs, with no spies.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).

## 3.1.1

### Patch Changes

- df8b85a: Rewrite the README: a bold promise, a Guarantees table, a short example, an animated diagram, a testing note and the full reference folded below.

## 3.1.0

### Minor Changes

- 3348934: Add `@n8io/baseline-error-tracking`: Error reports sent to Sentry (through `@sentry/core`) with their class name, stack, cause chain, error code and trace id, never their message. `@n8io/baseline-logger` gains `loggerErrorListen`, which hears every error logged at error or fatal, so the Template reports HTTP 500s, failed jobs and crashes without changing a caller. The Template reads an optional `SENTRY_DSN` (without it, errors are only logged) and removes it all with `pnpm piece-remove error-tracking`.

## 3.0.0

### Major Changes

- d63058e: Public types no longer carry vendor types. `Authn` is opaque (its fields were internal), and `actorFromClaims` takes `AuthnClaims`, a plain `Record<string, unknown>`, in place of jose's `JWTPayload`. `logger` is typed as the package's own `Logger` (the level methods and `level`), not pino's: a call is `(fields, message?)` or `(message)`, with no `child`, no printf-style arguments and a read-only `level`. Only an `Authn` from `authnCreate` is accepted; a hand-built or cloned one throws.

## 2.1.0

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.

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
