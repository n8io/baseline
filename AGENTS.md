# Baseline

A template repo for new projects: shared `@n8io/baseline-*` packages and the `apps/app` template that new repos are generated from.

Glossary: @CONTEXT.md. [CONTEXT-MAP.md](CONTEXT-MAP.md) lists every glossary; read [apps/app/CONTEXT.md](apps/app/CONTEXT.md) before naming anything in `apps/app`.

## Verify

Run with Node 26 (`fnm use`) and pnpm from `packageManager`.

- setup: `pnpm install`
- format: `pnpm format`
- lint + typecheck (root files): `pnpm check`
- test (root files): `pnpm test` (needs Docker: it starts the Postgres and Redis containers)
- test in a package: `pnpm test` runs every test; in cache, live, postgres, queue and pulsar it needs Docker, which only the files named `*.redis.test.ts`, `*.postgres.test.ts` or `*.pulsar.test.ts` use
- unit tests with no Docker: `pnpm test:unit` (root runs it in every package that has it, or run it inside one package)
- glossary warnings (root `CONTEXT.md`): `node apps/app/scripts/glossary-check.ts CONTEXT.md .`
- full CI-equivalent: `pnpm turbo run check test build`

## Naming

Packages, scripts and tests follow the app's naming rule in [apps/app/AGENTS.md](apps/app/AGENTS.md#where-new-work-goes): generic to specific, so `postgresPoolCreate`, never `createPostgresPool`. `test/naming.test.ts` runs its check (A23) outside `apps/app/src`.

## Vendors

A Package's exports name no vendor type, error or option shape; a caller must not change when the vendor behind a Package does. Two exceptions, both only on a factory that is one vendor's: its name says so (`cacheStoreRedisCreate`, `pulsarCreate`, `postgresPoolCreate`) or its whole Package is that vendor's (`queueCreate` is pg-boss's). Such a factory takes one options object, never positional arguments.

- Where the vendor has a client object, the factory takes the client, typed structurally (`cacheStoreRedisCreate({ redisClient })`).
- Where the Package must build the client, the factory takes a `vendor` option typed as the vendor's own settings, spreads it under the Package's own options, and throws on every key that those own or that would do nothing. Export the type named after the factory's subject (`PostgresPoolVendorOptions`). A function that opens its own connection to the same vendor (`postgresMigrate`) takes `vendor` too.

Never return the vendor's client from a neutral handle. The Project's side of this is [apps/app/docs/agents/vendor-settings.md](apps/app/docs/agents/vendor-settings.md).

## Tests

- A test for one source file sits beside it as `<name>.test.ts`.
- A test that needs a real service names it before `.test` (`.postgres.test.ts`, `.redis.test.ts`).
- A test that boots a process or spans many modules goes in `test/integration/`, with its setup and fixtures.
- Root `test/` tests the template and holds service setup shared across packages (`test/postgres/`, `test/redis/`).

A Package exports two things for tests, and no mocks, spies or fixtures:

- A memory adapter, `<package><Port>MemoryCreate` (`cacheStoreMemoryCreate`), in the main entry. It takes one options object or none. It is a real adapter, the one a `memory://` URL picks in development, so a `<port>.contract.ts` runs the same cases against it and the real adapter (`packages/cache/src/cache.contract.ts`).
- A test helper, `<package>Test<Thing><Verb>`, in `src/<package>-test-*.ts`. It takes one options object. `src/testing.ts` re-exports it as `@n8io/baseline-<package>/testing`, and nothing else does. Export one only when the Template would otherwise copy the Package's internals, or when the same helper appears twice; any other helper stays unexported beside its tests.

Nothing a Package exports imports a test runner, and no production source imports a test helper: `test/package-testing.test.ts` checks both. Only tests import `/testing` (architecture rule A24).

Tests assert with `expect()` only: `expect.requireAssertions` does not count chai `assert` calls, so Biome bans importing `assert` from `vitest` and `chai`.

In packages, only `@n8io/baseline-telemetry` starts spans, except a package that wraps a client no OpenTelemetry instrumentation covers: it starts that client's spans by the semantic conventions and carries W3C trace context itself (`@n8io/baseline-pulsar`: `send` and `process`). Other packages set attributes on the active span. The app's tracing and span rules are in [apps/app/docs/agents/tracing.md](apps/app/docs/agents/tracing.md).

A package handle that must be closed (a hub, a pool, a queue, a server) also has `[Symbol.asyncDispose]`, calling its named close. In package tests, open one inside a test body with `await using`. The rule and its traps are in [apps/app/docs/agents/using.md](apps/app/docs/agents/using.md).

## Walkthroughs

Each one guides a person through a process step by step. Read the one that matches before you start, or when someone asks to be walked through it.

- Creating a Project: [docs/agents/project-create.md](docs/agents/project-create.md)
- Shipping a change to a Package, the Template or `app-ci.yml`: [docs/agents/release.md](docs/agents/release.md)
- Running a Template upgrade in a Project: [apps/app/docs/agents/template-upgrade.md](apps/app/docs/agents/template-upgrade.md)
- Handling dependency updates: [apps/app/docs/agents/dependency-updates.md](apps/app/docs/agents/dependency-updates.md)
