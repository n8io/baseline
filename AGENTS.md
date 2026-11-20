# Baseline

Baseline holds the Template (`apps/app`), which every Project is made from, and the `@n8io/baseline-*` Packages that Projects depend on.

The glossary is [CONTEXT.md](CONTEXT.md). Use its terms for every name. The next line loads it in Claude Code, so it stays alone on its line:

@CONTEXT.md

[CONTEXT-MAP.md](CONTEXT-MAP.md) lists every glossary; read [apps/app/CONTEXT-MAP.md](apps/app/CONTEXT-MAP.md) and the glossaries it links before naming anything in `apps/app`.

## Verify

Run with Node 26 (`fnm use`) and pnpm from `packageManager`.

- cloud container setup (Node, pnpm, install, Docker): `bash apps/app/scripts/agent-setup.sh` ([apps/app/docs/agents/agent-setup.md](apps/app/docs/agents/agent-setup.md))
- setup: `pnpm install`
- format: `pnpm format`
- lint + typecheck (root files): `pnpm check`
- test (root files): `pnpm test` (needs Docker: it starts the Postgres and Redis containers)
- test in a Package: `pnpm test` runs every test; in cache, live, postgres, queue and redis it needs Docker, which only the files named `*.redis.test.ts` or `*.postgres.test.ts` use
- unit tests with no Docker: `pnpm test:unit` (root runs it in every Package, or run it inside one)
- glossary warnings (root `CONTEXT.md`): `node apps/app/scripts/glossary-check.ts CONTEXT.md .`
- CI's `packages` job: `pnpm exec turbo run check test build`; a Template change must also pass the other jobs ([docs/agents/template.md](docs/agents/template.md))
- a change that should ship: `pnpm exec changeset`, for each Package it touches, plus `app` for a Template change

## Naming

Packages, scripts and tests follow the Template's naming rule in [apps/app/AGENTS.md](apps/app/AGENTS.md#where-new-work-goes): generic to specific, so `postgresPoolCreate`, never `createPostgresPool`. `test/naming.test.ts` runs its check (A23) outside `apps/app`.

## Function inputs

As in [apps/app/AGENTS.md](apps/app/AGENTS.md): at most two positional inputs, then one typed input object, whose optional fields are `?: T | null`. Biome's `useMaxParams` misses `export default function` and type signatures; test helpers are exempt.

## Tests

- A test for one source file sits beside it as `<name>.test.ts`.
- A test that needs a real service names it before `.test` (`.postgres.test.ts`, `.redis.test.ts`).
- Root `test/` checks the Template, its render, the repo's docs and the Packages' metadata and names (`naming`, `package-metadata`, `package-testing`, `dependencies-allowed`), and holds service setup shared across Packages (`test/postgres/`, `test/redis/`). A Package has no `test/` folder.

Tests assert with `expect()` only: `expect.requireAssertions` does not count chai `assert` calls, so Biome bans importing `assert` from `vitest` and `chai`.

## Read when

These docs load only when the task needs them. Read the one that matches before you start.

- Working in `packages/` (a new Package, a factory, an option, a schema, a dependency, a handle to close, a test, a span): [docs/agents/packages.md](docs/agents/packages.md)
- Writing a README or a README diagram: [docs/agents/readmes.md](docs/agents/readmes.md)
- Changing anything under `apps/app` or `.github/workflows/` in baseline: [docs/agents/template.md](docs/agents/template.md)
- Proposing a new library, pattern or name, or recording a decision: read [docs/adr/](docs/adr/README.md) first

## Walkthroughs

Each one guides a person through a process step by step. Read the one that matches before you start, or when someone asks to be walked through it.

- Creating a Project: [docs/agents/project-create.md](docs/agents/project-create.md)
- Shipping a change to a Package, the Template or `app-ci.yml`: [docs/agents/release.md](docs/agents/release.md)
- Running a Template upgrade in a Project: [apps/app/docs/agents/template-upgrade.md](apps/app/docs/agents/template-upgrade.md)
- Handling dependency updates: [apps/app/docs/agents/dependency-updates.md](apps/app/docs/agents/dependency-updates.md)
