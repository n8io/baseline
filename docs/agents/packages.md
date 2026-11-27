# Package rules

Read before working in `packages/`: on a factory, an option, a schema, a dependency, a handle to close, a test, a span, or a new Package.

## Vendors

A Package's exports name no vendor type, error or option shape; a caller must not change when the vendor behind a Package does. Two exceptions, both only on a factory that is one vendor's: its name says so (`cacheStoreRedisCreate`, `postgresPoolCreate`) or its whole Package is that vendor's (`queueCreate` is pg-boss's). Such a factory takes one options object, never positional arguments.

- Where the vendor has a client object, the factory takes the client, typed structurally (`cacheStoreRedisCreate({ redisClient })`).
- Where the Package must build the client, the factory takes a `vendor` option typed as the vendor's own settings, spreads it under the Package's own options, and throws on every key that those own or that would do nothing. Export the type named after the factory's subject (`PostgresPoolVendorOptions`). A function that opens its own connection to the same vendor (`postgresMigrate`) takes `vendor` too.

Never return the vendor's client from a neutral handle. Why it is these two ways and never a client getter: [ADR 0005](../adr/0005-vendor-escape-hatch.md). The Project's side of this is [apps/app/docs/agents/vendor-settings.md](../../apps/app/docs/agents/vendor-settings.md).

## Options and handles

One rule for each thing that drifted between Packages. Function inputs follow the root [AGENTS.md](../../AGENTS.md#function-inputs).

- **Options type.** A factory that takes an options object exports its type as `<Subject>Options`, the subject being the factory's name without `Create` (`PostgresPoolOptions`, `SdkFetchOptions`), and its `vendor` key's type as `<Subject>VendorOptions`. A test helper's options type follows the same rule (`QueueTestConsumerRunOptions`). `ShutdownOptions` keeps its published name: its subject is the shutdown handle.
- **Optional fields** are `?: T | null`, and `null` means the default, as leaving it out does. The one exception says so in its JSDoc: `PostgresPoolOptions.queryTimeoutMs: null` turns the limit off. A `vendor` type keeps the vendor's own optional keys as the vendor writes them, and an overload switch (`CacheOptions.keyOf?: undefined`) is not an option.
- **Durations** are milliseconds, and the name ends in `Ms` (`timeoutMs`, `deadlineMs`, `renewMs`). `test/package-names.test.ts` checks it.
- **URLs.** The Project's own origin is `baseUrl`. A connection string is `url` for a client of one service (`redisClientCreate({ url })`), and `databaseUrl` where Packages share one store read from `DATABASE_URL` (postgres, queue).
- **Bad options** throw `TypeError` when the factory is called, with a message that starts with the function and the option and ends `found <value>` when the value is safe to echo: `cacheCreate: onStoreError must be "miss" or "throw", found "x"`. A factory checks every numeric or enumerated option it is given, and the scheme of a connection string, so a mistake fails at boot and not as a later outage. A duration that reaches a timer or a Postgres setting is at most 2147483647. The factory's JSDoc and its README row name the options it refuses. A handle from the wrong factory fails the same way: `liveStreamCreate: liveHub must come from liveHubRedisCreate or liveHubMemoryCreate`. An error that can only happen later, at runtime, is documented on the export that throws it.
- **Closing.** A handle the Package defines closes with `close()`, and its `[Symbol.asyncDispose]` calls `close()`. A vendor's own type keeps its own name (`PostgresPool.end()`, `RedisClient.close()`). Telemetry has no handle: its step is `telemetryShutdown()`. In a Package test, open a handle inside the test body with `await using`; the rule and its traps are in [apps/app/docs/agents/using.md](../../apps/app/docs/agents/using.md).
- **Predicates.** An exported function names its subject first, then `Is`, `Has` or `Can`, so it reads as English (`postgresErrorIsUniqueViolation`). A method or an option callback keeps the JavaScript form (`isAlive()`, `isShuttingDown`).
- **Readonly.** An exported signature takes and returns `readonly T[]`, `ReadonlyMap` and `ReadonlySet`, never `T[]`, `Map` or `Set`, so a caller's array is never edited and the one a Package returns cannot be. A signature that must stay mutable (an array a test reads back, a vendor type that asks for one) has `// mutable: <why, three words or more>` on the line above the export or the property; `test/readonly-types.test.ts` checks it.
- **Doc comments.** Every exported function and type has a `/** */` JSDoc: it ships in the `.d.ts`, so an editor shows it to the caller. A `//` comment does not ship.
- **Files.** A file is named after its main export in kebab case, without `Create` (`sdk-fetch.ts` holds `sdkFetchCreate`, `live-hub-memory.ts` holds `liveHubMemoryCreate`), or after the subject its exports share (`authn-cookie.ts`); A23 checks it. Its test is named after the file (`sdk-fetch.test.ts`), or after the file and one aspect when one file's tests split (`authn-routes-oidc.test.ts`). A private helper is tested through the exported function that calls it. `src/index.ts` only re-exports. A new subpath entry is `src/<subpath>.ts` (`testing.ts`, `client.ts`), or `src/<subpath>/index.ts` when it has several files of its own (feature-flags' `launchdarkly/`, `react/`); logger's `./err-serialize` and telemetry's `./span` are older and keep their file names. A private function needs no Package prefix: A23 reads exports only.
- **Shared helpers.** A helper two Packages need goes in `@n8io/baseline-shared`: a regular dependency, no dependencies of its own, runs in Node and browsers, and no Project calls it (its README lists what it holds). A Package copies a helper of about 20 lines instead only where it must not depend on a Package that brings a runtime (feature-flags copies telemetry's flag-evaluation record, so it never pulls in the OpenTelemetry SDK). Each side names the other: `// Copied from <path>; keep the two in step.` above the copy, and `// Copied to <path>; keep the two in step.` above the original (where neither came first, both say `Copied from`).

## Schemas

A Package may use Zod inside, as a regular dependency. A caller never needs it: no export names a Zod type, and `zod` is never a peer dependency. Where a caller passes a schema, take any Standard Schema (`StandardSchemaV1` from `@standard-schema/spec`, as `cacheCreate` and `queueConsumerCreate` do), and show a Zod example in the README. `@n8io/baseline-http` is the one exception: it is built on `@hono/zod-openapi` ([ADR 0006](../adr/0006-zod-inside-packages.md)).

## Dependencies

Every runtime dependency of a Package (`dependencies`, `peerDependencies`, `optionalDependencies`) needs an entry in the root `dependencies-allowed.json`: its name and a one-line reason naming the Packages that use it. `test/dependencies-allowed.test.ts` fails on one without, and on an entry no Package uses. Add one only for an established, industry-standard library that no listed one already covers, and ask first. `@n8io/baseline-*` packages need no entry. The Template's own list is `apps/app/dependencies-allowed.json` ([apps/app/docs/agents/dependency-updates.md](../../apps/app/docs/agents/dependency-updates.md)).

- **Ranges** are caret (`^1.2.3`). Pin an exact version only with its reason written in that dependency's `dependencies-allowed.json` line, such as OpenTelemetry's packages, which must match each other.
- **Peers** are only what the code imports, types included. An optional peer nothing imports goes, with its Needs line.
- **One runtime dependency is left out of package.json on purpose.** Telemetry's callers install `import-in-the-middle` beside it, because Node's loader hook and the instrumentations must share one copy. Its README says so in the install line and Needs; do not make it a peer.

## Test exports

A Package exports two things for tests, and no mocks, spies or fixtures.

A **memory stand-in**, in the main entry, in one of four shapes (feature-flags' memory flags and client are the exception: nothing but tests wants them, so they are exported from `/testing`). Copy the one closest to the new Package; a fifth shape needs a decision first.

| Shape           | Who                                   | What                                                                                                                                                                                                                                                                                                                                                              |
| --------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory adapter  | cache, live, queue's Events publisher | `<package><Port>MemoryCreate` (`cacheStoreMemoryCreate`): a real adapter of the same port, taking one options object or none, for unit tests and a `memory://` URL in development. A `<package>-<port>.contract.ts` runs the same cases against it and the real adapter: `cache-store.contract.ts`, `live-hub.contract.ts`, `queue-events-publisher.contract.ts`. |
| Logger fallback | analytics, feature-flags              | `analyticsLoggerCreate()` logs what the vendor adapter would send; `featureFlagsFallbackCreate` answers every flag with its declared fallback. The Project opens it when the vendor's token or key is unset.                                                                                                                                                      |
| Memory mode     | authn                                 | The factory itself runs in memory (`issuerUrl: "memory://"`), so no second export exists.                                                                                                                                                                                                                                                                         |
| None            | error-tracking                        | The Project skips opening it when `SENTRY_DSN` is unset.                                                                                                                                                                                                                                                                                                          |

A **test helper**, `<package>Test<Thing><Verb>`, in `src/<package>-test-*.ts`. Like every test file it is exempt from the function-inputs rule (Biome's `useMaxParams` is off for `*-test-*.ts` and `*.test.ts`), but an options object still reads better past two inputs. `src/testing.ts` re-exports it as `@n8io/baseline-<package>/testing`, and nothing else does. Export one only when the Template would otherwise copy the Package's internals, or when the same helper appears twice; any other helper stays unexported beside its tests.

A pure function with an invariant (a round trip, an order, never throws) also gets `<name>-property.test.ts` with `fast-check` (`id-property.test.ts`), and a public generic gets `<name>-types.test.ts` with `expectTypeOf` (`id-types.test.ts`). Each type test also asserts one value, because `requireAssertions` counts only run-time assertions. `pnpm knip` (root) fails on an unused file, export or dependency: delete it, un-export it, or ignore it in `knip.jsonc` with the reason beside it.

Nothing a Package exports imports a test runner, and no production source imports a test helper: `test/package-testing.test.ts` checks both. Only tests import `/testing` (architecture rule A24). Tests use `it`, not `test`, and no Package or Template test uses a mock, spy, stub or fake timer (Biome plugins `it-not-test` and `no-mocks` fail `pnpm check`). To reach a clock, a `fetch`, a logger or a process, give the factory an option for it (`now`, `fetch`, `logger`, `host`) and pass a plain function in the test. A README's testing note shows the memory stand-in.

## Spans and metrics

Only `@n8io/baseline-telemetry` starts spans (the `spans-in-telemetry` Biome plugin checks it). Other Packages set attributes on the active span through `@opentelemetry/api` (a peer), not through `@n8io/baseline-telemetry/span`, so no Package depends on telemetry; `/span` is for a Project's Use cases. Feature-flags records each flag evaluation the same way, as a log record through `@opentelemetry/api`, in the words of the OpenTelemetry feature-flag conventions. The Project's tracing and span rules are in [apps/app/docs/agents/tracing.md](../../apps/app/docs/agents/tracing.md).

A Package that counts or times something gets its meter from `metrics.getMeter("@n8io/baseline-<package>")` and names each instrument `baseline.<package>.<snake_name>` (`baseline.queue.dead_letters`; telemetry's `baseline.use_case.duration` is named for the Use case it times), with a UCUM unit where it has one (`ms`, `s`, `{event}`) and a description in glossary terms with no full stop. An attribute that names the queue or Consumer is `messaging.destination.name`.

## New Package

Copy the closest Package's folder, delete its `CHANGELOG.md` (the Release writes a new one), and change, in one pull request:

1. `package.json`: `name` `@n8io/baseline-<name>`, `version` `0.0.0`, and a `description` taken from the README's bold promise in glossary terms (Project, not app; no vendor first), ending in a full stop. Keep the other fields as every Package has them, in this order: `license`, `type`, `engines`, `repository.directory`, `exports` to `src/`, `files`, `publishConfig.exports` to `dist/`, the `build`, `check`, `prepack`, `test` and `test:unit` scripts (`test:unit` runs the tests that need no Docker: `vitest run` where none do, else the `unit` Vitest project), then the dependency maps. A `/testing` subpath goes in both `exports` maps. No `keywords`, `homepage` or `bugs`. `test/package-metadata.test.ts` checks the key order, the scripts, the full stop and the `LICENSE` copy.
2. `tsdown.config.ts`: one entry per subpath; `platform: "neutral"` for code that also runs in browsers (sdk, the `client` entries), else `"node"`.
3. `vitest.config.ts`, and a `turbo.json` when its tests use a shared service setup under `test/` (cache's is the model).
4. `LICENSE`: a copy of the root one.
5. `README.md` by [readmes.md](readmes.md), and a row in the root README's Packages table (`test/readmes.test.ts` fails on a Package with no row, and on an export its README never names).
6. A `dependencies-allowed.json` line for each new runtime dependency.
7. A changeset making it `major`, so the Release publishes `1.0.0`.

npm adds a trusted publisher only to a package that exists, so before that Release a maintainer publishes `0.0.0` once by hand with a short-lived token, then adds the trusted publisher (GitHub Actions, `n8io/baseline`, `release.yml`) on npmjs. Ask them; the Release fails until both are done.
