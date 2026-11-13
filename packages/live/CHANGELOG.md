# @n8io/baseline-live

## 7.1.0

### Minor Changes

- 1b14e24: Keep serving through a Redis outage.
  - cache: `cacheCreate` fails open. A store error or timeout is a miss on `get` and resolves on `set` and `delete`; it is counted on `baseline.cache.store_errors` and logged once per 30 s. After a failed `set` or `delete` the same process reads that id as a miss until the entry has expired. `onStoreError: "throw"` keeps the old behaviour. The package now has `@opentelemetry/api` as a peer.
  - live: `liveHub.send` never rejects. A lost update is counted on `baseline.live.sends_failed` and logged once per 30 s. When the Redis subscriber reconnects, every open stream sends `ready` again within 1 to 5 s, so pages reread what they missed. The package now has `@opentelemetry/api` as a peer.
  - app: no code to change in a Project. Tests show a Use case still answers with the cache store or the hub down, and `docs/agents/pieces.md` states how stale a cached read can be (the entry's lifetime, 60 s by default).

## 7.0.0

### Major Changes

- bcdb0ce: A function with three or more inputs takes one typed input object, and Biome's `useMaxParams` (max 2) now fails on a third parameter in the packages and the Template. A callback whose shape a library fixes (pino's `logMethod`, the Pulsar client's log, `String.replace`, the `DrizzleQueryError` constructor in a logger test) carries a `biome-ignore` naming that library.

  Breaking changes in the packages, with the new call:
  - `@n8io/baseline-cache`: `CacheStore.set({ json, key, ttlMs })`. A Project's own `CacheStore` changes its `set` the same way. `Cache<T>.set(id, value)` is unchanged.
  - `@n8io/baseline-live/client`: `useLiveUpdates({ channel, id, pathPrefix? })`.
  - `@n8io/baseline-postgres`: `postgresTransactionRun({ pgPool, timeoutMs?, work })`, where a `null` or missing `timeoutMs` means 5 s.
  - `@n8io/baseline-queue`: `queueConsumerCreate({ eventName, queueName, run, schema })`, `queueScheduleCreate({ cron, name, run })`, `queueSchedulesRegister({ env, queue, schedules })` and `queueJobRun({ job, queueName, work })`.

  `@n8io/baseline-authn` and `@n8io/baseline-pulsar` change only inside.

  In the Template, `useLiveUpdates`, `queueScheduleCreate`, `queueSchedulesRegister` and the test helpers move to the object form. A Use case that a Consumer calls takes the `inbox` in its input, `u.invoiceCreate(actor, { amountCents, customerId, inbox })`, so a Use case keeps two parameters. To upgrade a Project: change each call above, including every Domain's `api/<domain>-schedule.ts` (`queueScheduleCreate`), `src/worker.ts` (`queueSchedulesRegister`), each `ui/routes/<domain>-detail.tsx` (`useLiveUpdates`), each `spi/<domain>-transaction.postgres.ts` (`postgresTransactionRun`) and each Consumer and the Use case it calls. Each Domain's tests copied from foo change too: `spi/<domain>-transaction.postgres.test.ts` (`queueConsumerCreate`), `test/integration/<domain>-worker-shutdown.test.ts` (`productionServerWaitFor`), and the local helpers in `api/<domain>-routes.test.ts`, `ui/routes/<domain>-detail.test.ts` and `use-cases/<domain>-stale-archive.test.ts`; then run `pnpm check`, which names any function left with three parameters.

## 6.0.0

### Major Changes

- a61f217: Every handle that must be closed now has `[Symbol.asyncDispose]`, which calls its named close, so `await using` closes it however its block ends: `LiveHub` (`close`), `Queue` (`stop`), `HealthServer` (`close`), `Analytics` (`close`), `Pulsar` (`close`) and `PostgresPool` (`end`; the type is now pg's pool plus `AsyncDisposable`, and `postgresPoolCreate` adds the method to the pool it returns). The named methods stay.

  Breaking for code that builds one of these handles by hand, such as a test fake typed `LiveHub` or `Analytics`, or a raw `pg.Pool` passed where a `PostgresPool` is expected: add `[Symbol.asyncDispose]`, or build the pool with `postgresPoolCreate`.

  In the Template, `docs/agents/using.md` states the rule: use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process.

### Minor Changes

- 797590d: `@n8io/baseline-live/testing` is new: `liveTestSseRead({ response })` reads a live stream in a test. `until(text)` waits for text to arrive, `end()` waits for the server to end the stream and `cancel()` goes away like a page that closes. Import it from test files only. The README has a Testing section with the memory hub and the reader together.

  In the Template, the Foo tests read their live streams with this reader, so no test reads a response body by hand. When you upgrade, a Domain test that copied the hand-written reader can use `liveTestSseRead` in its place.

### Patch Changes

- Updated dependencies [3348934]
  - @n8io/baseline-logger@3.1.0

## 5.0.0

### Major Changes

- 1137ee3: Three more Package surfaces stop naming a vendor.

  `@n8io/baseline-live`: `liveStreamCreate({ liveHub, channel, id, expiresAt, signal })` no longer takes a Hono context. It answers a web `Response` for any server, and the `hono` peer is gone. Pass the request's `signal` (`c.req.raw.signal` in Hono) so the stream ends when the request is aborted. A page that stops reading is dropped once 64 KiB wait for it. The response no longer sends `Connection: keep-alive`, which HTTP/2 forbids.

  `@n8io/baseline-postgres`: `postgresPoolCreate` takes `{ databaseUrl, max?, connectTimeoutMs? }`, not pg's `PoolConfig`. The Package exports `PostgresPool` and `PostgresClient`; name those in your own signatures. They are still pg's pool and client, because Drizzle needs the real ones. Other `PoolConfig` overrides (`ssl`, `idleTimeoutMillis` and the rest) are no longer accepted; put them in the database URL where pg reads them, or ask for an option.

  `@n8io/baseline-telemetry`: the new `@n8io/baseline-telemetry/span` entry exports `telemetrySpanAttributesSet(attributes)` and `telemetrySpanRun(name, work)`.

  In the Template, no file in `src/` imports `@opentelemetry/api` or `pg`: Use cases set span attributes with `telemetrySpanAttributesSet`, and architecture rules A8 and A21 enforce it. Architecture rule A16 now reads `telemetrySpanAttributesSet` and also allows a `baseline.<domain>.<thing>_count` key. When you upgrade: remove the first argument of each `liveStreamCreate` call, pass `signal` and answer with `c.newResponse(live.body, live)` as Foo's `api/foo-live.ts` does (a bare `Response` loses headers that middleware set with `c.header()`), replace `trace.getActiveSpan()?.setAttributes(...)` with `telemetrySpanAttributesSet(...)` and a hand-written child span with `telemetrySpanRun`, replace `pg.Pool` with `PostgresPool`, and rename a `connectionTimeoutMillis` override to `connectTimeoutMs`.
- 867f91e: Vendor-only settings have one way in. `postgresPoolCreate`, `postgresMigrate`, `queueCreate`, `queueMigrate`, `pulsarCreate` and `analyticsMixpanelCreate` take a `vendor` option, typed as the vendor's own settings and passed through: `ssl` for Postgres, pg-boss's tuning, OAuth2 or mTLS for Pulsar, Mixpanel's `host` for data residency. A Package's named options win, and `vendor` throws on the keys they set and on the ones that would do nothing. `vendor` is outside each Package's contract: it is not tested, and a vendor swap deletes it.

  In the Template, `docs/agents/vendor-settings.md` says when to use it, and architecture rule A12 allows the vendor factories only in `src/connections.ts`, `src/redis.ts` and the `src/*-open.ts` files.

  A factory that is one vendor's takes one options object: `analyticsMixpanelCreate({ token, vendor? })`, `cacheStoreRedisCreate({ redisClient })` and `liveHubRedisCreate({ redisClient })` replace their positional forms. When you upgrade, wrap the argument of those three calls.

### Patch Changes

- Updated dependencies [d63058e]
  - @n8io/baseline-logger@3.0.0

## 4.0.0

### Major Changes

- dc8c9de: live no longer depends on `@n8io/baseline-cache`, so a project can install live without cache. `liveHubRedisCreate` takes any connected node-redis client, including the one `cacheRedisClientCreate` returns, and owns its own timeout. cache no longer exports `cacheTimeLimit`; copy the few lines into your code if you used it.

### Minor Changes

- f86d684: `react` and `react-router` are now optional peers, needed only for `@n8io/baseline-live/client`, so a service that only sends or streams live updates can install live without React. `useLiveUpdates` takes an optional `{ pathPrefix }` (default `/live`) for a Project that mounts the streams elsewhere.

## 3.0.0

### Major Changes

- 2685036: The live hub factories follow the entity-first, verb-last naming: `liveMemory` is now `liveHubMemoryCreate` and `liveRedis` is now `liveHubRedisCreate`. There are no deprecated aliases; rename the imports in your composition roots and tests.

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [5467b94]
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-cache@3.0.0
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
  - @n8io/baseline-cache@2.0.0
  - @n8io/baseline-logger@2.0.0

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-logger@1.0.0
