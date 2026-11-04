# Baseline

A template repo for new projects: shared `@n8io/baseline-*` packages and the `apps/app` template that new repos are generated from.

@CONTEXT.md
@apps/app/CONTEXT.md

## Verify

Run with Node 26 (`fnm use`) and pnpm from `packageManager`.

- setup: `pnpm install`
- format: `pnpm format`
- lint + typecheck (root files): `pnpm check`
- test (root files): `pnpm test` (needs Docker: it starts the Postgres and Redis containers)
- full CI-equivalent: `pnpm turbo run check test build`

## Naming

Packages, scripts and tests follow the app's naming rule in [apps/app/AGENTS.md](apps/app/AGENTS.md#where-new-work-goes): generic to specific, so `postgresPoolCreate`, never `createPostgresPool`. `test/naming.test.ts` runs its check (A23) outside `apps/app/src`.

## Tests

- A test for one source file sits beside it as `<name>.test.ts`. Test helpers sit beside the tests that use them and are never exported from `index.ts`.
- A test that needs a real service names it before `.test` (`.postgres.test.ts`, `.redis.test.ts`).
- A test that boots a process or spans many modules goes in `test/integration/`, with its setup and fixtures.
- Root `test/` tests the template and holds service setup shared across packages (`test/postgres/`, `test/redis/`).

Tests assert with `expect()` only: `expect.requireAssertions` does not count chai `assert` calls, so Biome bans importing `assert` from `vitest` and `chai`.

In packages, only `@n8io/baseline-telemetry` starts spans, except a package that wraps a client no OpenTelemetry instrumentation covers: it starts that client's spans by the semantic conventions and carries W3C trace context itself (`@n8io/baseline-pulsar`: `send` and `process`). Other packages set attributes on the active span. The app's tracing and span rules are in [apps/app/AGENTS.md](apps/app/AGENTS.md#tracing).
