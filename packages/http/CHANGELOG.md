# @n8io/baseline-http

## 4.0.1

### Patch Changes

- Updated dependencies [0202e13]
- Updated dependencies [f89d502]
  - @n8io/baseline-shared@0.1.1
  - @n8io/baseline-logger@4.0.0

## 4.0.0

### Major Changes

- 8745155: Tidy feature flags and secure headers.
  - http: remove the `httpSecureHeaders` constant. Use `httpSecureHeadersCreate()` (same headers, no extra origins).
  - feature-flags: drop the unused `@openfeature/core` peer and the `@n8io/baseline-telemetry` dependency (the evaluation log record now goes through `@opentelemetry/api`, an optional peer of the server adapter); add the `/launchdarkly/origins` entry so a server loads the CSP origins without the browser SDKs (`/launchdarkly/client` still re-exports it); throw a `TypeError` from both factories on an empty key or a `readyTimeoutMs` that is not a whole number of milliseconds from 1 to 2147483647 (0, negative and fractional values were accepted before, and now fail at boot); record evaluations under the instrumentation scope `@n8io/baseline-feature-flags` instead of `@n8io/baseline-telemetry`; export `FeatureFlagsFallbackOptions`, `FeatureFlagsOnFallback` and `FeatureFlagsLaunchDarklyClientVendorOptions`.
  - feature-flags, sdk, live, authn: add `sideEffects: false` so bundlers can tree-shake them.

### Minor Changes

- da3de3f: Add `httpErrorHandleCreate({ logger })`, so a test records the error log. `httpErrorHandle` is `httpErrorHandleCreate()`.

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

- c470b6a: `httpSecureHeadersCreate({ connectSrc? })` builds the secure headers middleware with extra origins in the CSP's `connect-src`, for a page whose own scripts call another origin. The policy now always names `connect-src 'self'`, which it used to take from `default-src`, so the header gains that directive. `httpSecureHeaders` is unchanged otherwise.

## 3.1.0

### Minor Changes

- 3e45f69: Exported types and functions take and return readonly arrays (errors, codes), so a caller's array is never edited and an array a Package returns cannot be. A mutable array a caller passes in still compiles; code that edits a returned array, or hands it to a function that wants `T[]`, copies it first.

### Patch Changes

- d5953b6: Doc comments on `httpErrorBodyCreate` and `httpRouterCreate` no longer name functions the Package does not export. README folds are tidied.
- Updated dependencies [d5953b6]
- Updated dependencies [f0993b4]
  - @n8io/baseline-logger@3.1.3

## 3.0.2

### Patch Changes

- d580a34: `httpErrorHandle` logs its 500 with a message ("Request failed; answered 500 InternalError"). Doc comments say "bounded context" and "business error" instead of "domain", every export has a JSDoc, internal helpers take the `http` prefix, the keep-alive values name their copy in health, and the README examples show their imports.
- 84c85e1: README and doc comment wording: examples show their imports, Exports rows name each export, and glossary words read as the glossary writes them.
- e7bc75a: Internal names and tests tidied; adds the `test:unit` script so root `pnpm test:unit` runs this Package's tests.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
- Updated dependencies [e7bc75a]
- Updated dependencies [bfb7735]
- Updated dependencies [9a5b1a1]
  - @n8io/baseline-logger@3.1.2

## 3.0.1

### Patch Changes

- ccb666a: Rewrite the README: a bold promise, a Guarantees table, a short example, and the full reference folded below.
- Updated dependencies [df8b85a]
  - @n8io/baseline-logger@3.1.1

## 3.0.0

### Major Changes

- 64cd00e: Problem `code` is an extensible enum. `httpErrorResponsesCreate` now documents `code` as a string with `x-extensible-enum` listing its known values, so a route can answer a new error code on a status it already declares without oasdiff reporting `response-property-enum-value-added`. `types` also takes a `readonly` list (an `as const` array no longer fails with TS4104). The Template gains `pnpm api-check` (`scripts/api-check.ts`: oasdiff on `origin/main` against your working tree, the same command as CI's `oasdiff` job) and `docs/agents/api.md`, "Changing an API shape"; CI's `oasdiff` job now runs `pnpm api-check`.

  To upgrade a Project: every response's `code` changes from `enum` to `x-extensible-enum`, which oasdiff 1.35.0 reports as `response-property-became-not-enum` (an error) once per error response. `pnpm api-check` and CI's `oasdiff` job read the `main` document with the old closed list as the open one, so the upgrade PR passes without an ignore file; nothing to do. Apply the Template's `scripts/api-check.ts`, the `api-check` script in `package.json` and `docs/agents/api.md` if `pnpm template-upgrade` conflicts on them. Foo's routes are unchanged.

## 2.1.0

### Minor Changes

- 31cc578: Outlast the load balancer's idle timeout, and stop tracing idle polls.
  - http: `httpServerKeepAlive(server)` keeps idle connections open for 65 s (Node's default is 5 s) and gives headers 66 s. A load balancer with the usual 60 s idle timeout no longer reuses a connection the pod has closed, which the client saw as an occasional 502. Keep the balancer's idle timeout under 65 s.
  - app: `src/server.ts` calls `httpServerKeepAlive(server)` first in `serverServe`. A Project adds that line and its import on upgrade.
  - health: the probe server keeps idle connections for 65 s too, and `close()` now drops every open connection, so a half-sent probe cannot hold shutdown.
  - telemetry: pg and Redis spans are made only inside a trace (`requireParentSpan`). A query in a request, a Consumer or Schedule run or a use case keeps its span; a queue poll, boot or maintenance query makes none. Redis still makes one `redis-connect` span per connection it opens. pg's metrics follow its spans: `db.client.operation.duration` counts only queries inside a trace, and a pool's `db.client.connection.*` metrics start with its first query inside a trace.

## 2.0.1

### Patch Changes

- Updated dependencies [d63058e]
  - @n8io/baseline-logger@3.0.0

## 2.0.0

### Major Changes

- 1cc11af: Exports follow the full naming rule: factories end in `Create`, predicates end in `Is`, `Has` or `Can`, and every export starts with its package's name. No old names remain as aliases. Rename these imports:
  - authn: `authnRoutes` → `authnRoutesCreate`, `authnMiddleware` → `authnMiddlewareCreate`.
  - http: `httpErrorResponses` → `httpErrorResponsesCreate`, `httpErrorBody` → `httpErrorBodyCreate`, `httpProblemSchema` → `httpProblemSchemaCreate`.
  - id: `idSchema` → `idSchemaCreate`.
  - postgres: `postgresIdColumn` → `postgresIdColumnCreate`, `postgresTransaction` → `postgresTransactionRun`, `postgresUniqueViolation` → `postgresUniqueViolationIs`.
  - queue: `consumerCreate` → `queueConsumerCreate`, `consumersStart` → `queueConsumersStart`, `consumersSubscribe` → `queueConsumersSubscribe`, `scheduleCreate` → `queueScheduleCreate`, `schedulesRegister` → `queueSchedulesRegister`.
  - shutdown: `shutdownHandle` → `shutdownHandleCreate`.

### Minor Changes

- 6764931: `httpCsrf` wraps Hono's `csrf()` for cookie-authenticated routes: a form, multipart or text POST answers a 403 `Forbidden` problem unless `Sec-Fetch-Site` is `same-origin` or `Origin` is the server's public origin (https when `x-forwarded-proto` says so). The app runs it on every route except `/api/*`, which uses bearer tokens, so a cross-site post to a page action or to `/auth/sign-out` no longer relies on `SameSite=Lax` alone. A TLS-terminating proxy must set `x-forwarded-proto: https`.

## 1.2.0

### Minor Changes

- ca7afb0: `httpSecureHeaders` applies Hono's secure headers (HSTS, nosniff, Referrer-Policy and the rest) with an enforced Content-Security-Policy: `default-src 'self'`, `script-src 'self'` plus a per-request nonce, `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'`. The app uses it on every response and hands the nonce to React Router's server render, so every inline script carries it, in development too. Request bodies on `/api/*` are capped at 1 MB and a bigger one answers 413 `PayloadTooLarge`. The memory issuer's sign-in pages drop their inline styles, which the CSP blocks. Rate limiting stays at the load balancer or edge.
- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.
- acaff2a: Every problem+json body now carries `traceId`, the trace id of the request's active span, so a caller can report it and you can find the request's spans and logs (`trace_id`) by it. It is left out when nothing traces the request.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-logger@2.1.0

## 1.1.1

### Patch Changes

- Updated dependencies [b99f091]
  - @n8io/baseline-logger@2.0.0

## 1.1.0

### Minor Changes

- ef2b21c: `httpErrorResponses` now types each listed status, so a route whose responses all carry content can return its problem bodies, and only with those statuses. Adds the `HttpErrorResponses` type; a mistyped error type still fails type-checking.

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-logger@1.0.0
