# @n8io/baseline-authn

## 5.0.1

### Patch Changes

- bcdb0ce: A function with three or more inputs takes one typed input object, and Biome's `useMaxParams` (max 2) now fails on a third parameter in the packages and the Template. A callback whose shape a library fixes (pino's `logMethod`, the Pulsar client's log, `String.replace`, the `DrizzleQueryError` constructor in a logger test) carries a `biome-ignore` naming that library.

  Breaking changes in the packages, with the new call:
  - `@n8io/baseline-cache`: `CacheStore.set({ json, key, ttlMs })`. A Project's own `CacheStore` changes its `set` the same way. `Cache<T>.set(id, value)` is unchanged.
  - `@n8io/baseline-live/client`: `useLiveUpdates({ channel, id, pathPrefix? })`.
  - `@n8io/baseline-postgres`: `postgresTransactionRun({ pgPool, timeoutMs?, work })`, where a `null` or missing `timeoutMs` means 5 s.
  - `@n8io/baseline-queue`: `queueConsumerCreate({ eventName, queueName, run, schema })`, `queueScheduleCreate({ cron, name, run })`, `queueSchedulesRegister({ env, queue, schedules })` and `queueJobRun({ job, queueName, work })`.

  `@n8io/baseline-authn` and `@n8io/baseline-pulsar` change only inside.

  In the Template, `useLiveUpdates`, `queueScheduleCreate`, `queueSchedulesRegister` and the test helpers move to the object form. A Use case that a Consumer calls takes the `inbox` in its input, `u.invoiceCreate(actor, { amountCents, customerId, inbox })`, so a Use case keeps two parameters. To upgrade a Project: change each call above, including every Domain's `api/<domain>-schedule.ts` (`queueScheduleCreate`), `src/worker.ts` (`queueSchedulesRegister`), each `ui/routes/<domain>-detail.tsx` (`useLiveUpdates`), each `spi/<domain>-transaction.postgres.ts` (`postgresTransactionRun`) and each Consumer and the Use case it calls. Each Domain's tests copied from foo change too: `spi/<domain>-transaction.postgres.test.ts` (`queueConsumerCreate`), `test/integration/<domain>-worker-shutdown.test.ts` (`productionServerWaitFor`), and the local helpers in `api/<domain>-routes.test.ts`, `ui/routes/<domain>-detail.test.ts` and `use-cases/<domain>-stale-archive.test.ts`; then run `pnpm check`, which names any function left with three parameters.

## 5.0.0

### Major Changes

- d75cd90: `@n8io/baseline-authn/testing` is new: `authnTestSignIn({ url, who, secret })` signs in at a served app through the memory issuer's form and returns `authorization`, `cookie`, `token` and `accessCookie`. It opens the access cookie with the package's own cookie code. Import it from test files only. The README has a Testing section.

  `authnMemoryTokenCreate` takes one options object: `authnMemoryTokenCreate({ authn, actor })`. A call that passes `authn` and the Actor as two arguments no longer compiles.

  In the Template, `test/integration/integration-sign-in.ts` calls `authnTestSignIn` and holds no cryptography of its own; `integrationSignIn(url, who)` and `SignedIn` are unchanged, so tests that call it do not change. `src/server-wiring.test.ts` passes `{ actor, authn }`. When you upgrade, take the new `integration-sign-in.ts` whole, and change every `authnMemoryTokenCreate(authn, actor)` in your own tests to `authnMemoryTokenCreate({ actor, authn })`.
- 94f2893: Four Packages no longer need you to install Zod to use them. You bring the schema library, and each README shows how to pass a Zod schema.
  - `@n8io/baseline-cache` and `@n8io/baseline-queue`: `cacheCreate`'s `schema` and `queueConsumerCreate`'s schema are any [Standard Schema](https://standardschema.dev), so a Zod, Valibot or ArkType schema goes in as it is. Calls that pass a Zod schema do not change. The `zod` peer is gone. A Consumer's validation error now names the paths that failed in its message (`Event failed validation for billing.order-placed at totalCents`) and has no `cause`, so no validator's message can put an Event's values in a log.
  - `@n8io/baseline-id`: `idSchemaCreate` is gone. `idPatternCreate(prefix)` returns the `RegExp` to build an id schema from, in any schema library.
  - `@n8io/baseline-authn`: `Actor` is a type only; the Zod schema of the same name is no longer exported. Zod is the package's own dependency now, not a peer.

  `@n8io/baseline-http` keeps its `zod` peer: it is built on `@hono/zod-openapi`.

  In the Template, the new `src/id-schema.ts` exports `idSchemaCreate`, the Zod schema built from `idPatternCreate`. Foo: `models/foo.ts` imports `idSchemaCreate` from `../../../id-schema.ts`, not from `@n8io/baseline-id`, and `ui/routes/foo-detail.tsx` parses the id with `Foo.shape.id`. When you upgrade, change that import in every Domain's `models/<domain>.ts` and anywhere else that imports `idSchemaCreate`.

  This Release is `app@5.0.0`, so it creates the tag `v5`. The Template's `ci.yml` calls `app-ci.yml@v5` and `dependabot-automerge.yml@v5`; `v4` stays frozen at `app@4.0.0`.

### Patch Changes

- Updated dependencies [3348934]
  - @n8io/baseline-logger@3.1.0

## 4.0.0

### Major Changes

- d63058e: Public types no longer carry vendor types. `Authn` is opaque (its fields were internal), and `actorFromClaims` takes `AuthnClaims`, a plain `Record<string, unknown>`, in place of jose's `JWTPayload`. `logger` is typed as the package's own `Logger` (the level methods and `level`), not pino's: a call is `(fields, message?)` or `(message)`, with no `child`, no printf-style arguments and a read-only `level`. Only an `Authn` from `authnCreate` is accepted; a hand-built or cloned one throws.

### Patch Changes

- Updated dependencies [d63058e]
  - @n8io/baseline-logger@3.0.0

## 3.0.0

### Major Changes

- 8903db0: The main entry no longer imports React Router, so an API or Worker can verify tokens without installing `react` or `react-router`, which are now optional peers.
  - `actorContext` and `authnExpiryContext` move to the new `@n8io/baseline-authn/react-router` subpath.
  - `authnActorRequire` takes only a Hono `Context`. For a loader or action, import `authnPageActorRequire(args)` from `@n8io/baseline-authn/react-router`; it throws the same redirect to sign-in.
  - `authnCreate` refuses `issuerUrl: "memory://"` unless you pass `memoryIssuerAllowed: true`. Pass it only in development and test.
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

- ca7afb0: `httpSecureHeaders` applies Hono's secure headers (HSTS, nosniff, Referrer-Policy and the rest) with an enforced Content-Security-Policy: `default-src 'self'`, `script-src 'self'` plus a per-request nonce, `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'`. The app uses it on every response and hands the nonce to React Router's server render, so every inline script carries it, in development too. Request bodies on `/api/*` are capped at 1 MB and a bigger one answers 413 `PayloadTooLarge`. The memory issuer's sign-in pages drop their inline styles, which the CSP blocks. Rate limiting stays at the load balancer or edge.
- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-logger@2.1.0

## 2.0.0

### Major Changes

- b99f091: Trim exports nobody imports and the dependencies nobody uses.
  - logger: the root no longer exports `LoggerErr`, `loggerErrSerialize`, `loggerRedactPaths` or `LoggerFields`. Import `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
  - authn: the root no longer exports `AuthnInvalidError`.
  - live: the root no longer exports the `LiveUpdate` type. `liveRedis` now takes the `RedisClient` type and time limit from `@n8io/baseline-cache`.
  - cache: `cacheRedisClientCreate` takes only `{ cacheUrl }`, and the root exports `cacheTimeLimit`.
  - postgres: drops its unused `zod` peer dependency.
  - app: drops the unused `lucide-react` dependency.

### Patch Changes

- Updated dependencies [b99f091]
  - @n8io/baseline-logger@2.0.0

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-logger@1.0.0
