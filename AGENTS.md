# Baseline

A template repo for new projects: shared `@n8io/baseline-*` packages and the `apps/app` template that new repos are generated from.

The glossary is [CONTEXT.md](CONTEXT.md). Use its terms for every name. The next line loads it in Claude Code, so it stays alone on its line:

@CONTEXT.md

[CONTEXT-MAP.md](CONTEXT-MAP.md) lists every glossary; read [apps/app/CONTEXT.md](apps/app/CONTEXT.md) before naming anything in `apps/app`.

## Verify

Run with Node 26 (`fnm use`) and pnpm from `packageManager`.

- setup: `pnpm install`
- format: `pnpm format`
- lint + typecheck (root files): `pnpm check`
- test (root files): `pnpm test` (needs Docker: it starts the Postgres and Redis containers)
- test in a package: `pnpm test` runs every test; in cache, live, postgres and queue it needs Docker, which only the files named `*.redis.test.ts` or `*.postgres.test.ts` use
- unit tests with no Docker: `pnpm test:unit` (root runs it in every package that has it, or run it inside one package)
- glossary warnings (root `CONTEXT.md`): `node apps/app/scripts/glossary-check.ts CONTEXT.md .`
- full CI-equivalent: `pnpm turbo run check test build`

## Naming

Packages, scripts and tests follow the app's naming rule in [apps/app/AGENTS.md](apps/app/AGENTS.md#where-new-work-goes): generic to specific, so `postgresPoolCreate`, never `createPostgresPool`. `test/naming.test.ts` runs its check (A23) outside `apps/app/src`.

## Function inputs

One input, or two strongly coupled inputs (the second may be optional), may stay positional. Three or more inputs take one typed input object (`?: T | null` for optional fields). Biome's `useMaxParams` (max 2) catches functions; it misses `export default function` and type signatures (ports, method types), so keep those to the rule by hand.

## Tests

- A test for one source file sits beside it as `<name>.test.ts`.
- A test that needs a real service names it before `.test` (`.postgres.test.ts`, `.redis.test.ts`).
- A test that boots a process or spans many modules goes in `test/integration/`, with its setup and fixtures.
- Root `test/` tests the template and holds service setup shared across packages (`test/postgres/`, `test/redis/`).

Tests assert with `expect()` only: `expect.requireAssertions` does not count chai `assert` calls, so Biome bans importing `assert` from `vitest` and `chai`.

## Read when

This doc loads only when the task needs it. Read it before you start.

- Working in `packages/` (a factory, an option, a schema, a handle to close, a test, a span): [docs/agents/packages.md](docs/agents/packages.md)

## Walkthroughs

Each one guides a person through a process step by step. Read the one that matches before you start, or when someone asks to be walked through it.

- Creating a Project: [docs/agents/project-create.md](docs/agents/project-create.md)
- Shipping a change to a Package, the Template or `app-ci.yml`: [docs/agents/release.md](docs/agents/release.md)
- Running a Template upgrade in a Project: [apps/app/docs/agents/template-upgrade.md](apps/app/docs/agents/template-upgrade.md)
- Handling dependency updates: [apps/app/docs/agents/dependency-updates.md](apps/app/docs/agents/dependency-updates.md)
