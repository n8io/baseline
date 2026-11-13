# Package rules

Read before working in `packages/`: on a factory, an option, a schema, a handle to close, a test or a span.

## Vendors

A Package's exports name no vendor type, error or option shape; a caller must not change when the vendor behind a Package does. Two exceptions, both only on a factory that is one vendor's: its name says so (`cacheStoreRedisCreate`, `postgresPoolCreate`) or its whole Package is that vendor's (`queueCreate` is pg-boss's). Such a factory takes one options object, never positional arguments.

- Where the vendor has a client object, the factory takes the client, typed structurally (`cacheStoreRedisCreate({ redisClient })`).
- Where the Package must build the client, the factory takes a `vendor` option typed as the vendor's own settings, spreads it under the Package's own options, and throws on every key that those own or that would do nothing. Export the type named after the factory's subject (`PostgresPoolVendorOptions`). A function that opens its own connection to the same vendor (`postgresMigrate`) takes `vendor` too.

Never return the vendor's client from a neutral handle. The Project's side of this is [apps/app/docs/agents/vendor-settings.md](../../apps/app/docs/agents/vendor-settings.md).

## Schemas

A Package may use Zod inside, as a regular dependency. A caller never needs it: no export names a Zod type, and `zod` is never a peer dependency. Where a caller passes a schema, take any Standard Schema (`StandardSchemaV1` from `@standard-schema/spec`, as `cacheCreate` and `queueConsumerCreate` do), and show a Zod example in the README. `@n8io/baseline-http` is the one exception: it is built on `@hono/zod-openapi`.

## Test exports

A Package exports two things for tests, and no mocks, spies or fixtures:

- A memory adapter, `<package><Port>MemoryCreate` (`cacheStoreMemoryCreate`), in the main entry. It takes one options object or none. It is a real adapter, the one a `memory://` URL picks in development, so a `<port>.contract.ts` runs the same cases against it and the real adapter (`packages/cache/src/cache.contract.ts`).
- A test helper, `<package>Test<Thing><Verb>`, in `src/<package>-test-*.ts`. It follows the function-inputs rule in the root `AGENTS.md`. `src/testing.ts` re-exports it as `@n8io/baseline-<package>/testing`, and nothing else does. Export one only when the Template would otherwise copy the Package's internals, or when the same helper appears twice; any other helper stays unexported beside its tests.

Nothing a Package exports imports a test runner, and no production source imports a test helper: `test/package-testing.test.ts` checks both. Only tests import `/testing` (architecture rule A24).

## Spans

Only `@n8io/baseline-telemetry` starts spans, except a package that wraps a client no OpenTelemetry instrumentation covers: it starts that client's spans by the semantic conventions and carries W3C trace context itself. Other packages set attributes on the active span. The app's tracing and span rules are in [apps/app/docs/agents/tracing.md](../../apps/app/docs/agents/tracing.md).

## Handles to close

A handle that must be closed (a hub, a pool, a queue, a server) also has `[Symbol.asyncDispose]`, calling its named close. In a Package test, open one inside a test body with `await using`. The rule and its traps are in [apps/app/docs/agents/using.md](../../apps/app/docs/agents/using.md).
