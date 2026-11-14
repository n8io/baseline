# @n8io/baseline-http

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
