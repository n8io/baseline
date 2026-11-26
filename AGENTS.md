# Baseline

Baseline holds the Template (`apps/app`), which every Project is made from, and the `@n8io/baseline-*` Packages that Projects depend on.

The glossary is [CONTEXT.md](CONTEXT.md); use its terms for every name. This line loads it, so it stays alone:

@CONTEXT.md

[CONTEXT-MAP.md](CONTEXT-MAP.md) lists every glossary; read [apps/app/CONTEXT-MAP.md](apps/app/CONTEXT-MAP.md) and the glossaries it links before naming anything in `apps/app`.

## Verify

Run with Node 26 (`fnm use`) and pnpm from `packageManager`.

- cloud setup (Node, pnpm, install, Docker): `bash apps/app/scripts/agent-setup.sh` ([apps/app/docs/agents/agent-setup.md](apps/app/docs/agents/agent-setup.md))
- setup: `pnpm install`
- format: `pnpm format`
- lint + typecheck: `pnpm check`
- test (root files): `pnpm test` (needs Docker: it starts the Postgres and Redis containers)
- test in a Package: `pnpm test` runs every test; cache, live, postgres, queue and redis need Docker for `*.redis.test.ts` and `*.postgres.test.ts` only
- unit tests with no Docker: `pnpm test:unit` (root runs it in every Package, or run it inside one)
- dead code: `pnpm knip`
- glossary warnings (root `CONTEXT.md`): `node apps/app/scripts/glossary-check.ts CONTEXT.md .`
- CI's `packages` job: `pnpm exec turbo run check test build`; a Template change also passes the other jobs ([docs/agents/template.md](docs/agents/template.md))
- a change that should ship: `pnpm exec changeset` per Package it touches, plus `app` for the Template

## Where does X go

- a concern Projects share: a Package in `packages/`; a helper two Packages share: `packages/shared`
- a Template wiring file or script: `apps/app/src/*-open.ts`, `apps/app/scripts/`
- a lint rule: `apps/app/lint-plugins/*.grit`, wired in `biome.json`
- a maintainer script: `scripts/`; a decision: `docs/adr/`

## Naming

Names follow the Template's rule in [apps/app/AGENTS.md](apps/app/AGENTS.md#where-new-work-goes): generic to specific (`postgresPoolCreate`, never `createPostgresPool`). `test/naming.test.ts` checks it (A23) outside `apps/app`.

## Function inputs

As in [apps/app/AGENTS.md](apps/app/AGENTS.md): at most two positional inputs, then one typed object with `?: T | null` optionals. `useMaxParams` misses `export default function` and type signatures; test helpers are exempt.

## Tests

- A test for one source file sits beside it as `<name>.test.ts`.
- A test that needs a real service names it before `.test` (`.postgres.test.ts`, `.redis.test.ts`).
- Root `test/` checks the Template, its render, the docs and the Packages' metadata and names, and holds service setup the Packages share (`test/postgres/`, `test/redis/`). A Package has no `test/` folder.

Tests assert with `expect()` only: `expect.requireAssertions` ignores chai `assert`, so Biome bans importing it.

## Read when

Read the one that matches before you start.

- Working in `packages/` (a Package, factory, option, schema, dependency, handle, test or span): [docs/agents/packages.md](docs/agents/packages.md)
- Writing a README or a README diagram: [docs/agents/readmes.md](docs/agents/readmes.md)
- Changing anything under `apps/app` or `.github/workflows/` in baseline: [docs/agents/template.md](docs/agents/template.md)
- Proposing a new library, pattern or name, or recording a decision: read [docs/adr/](docs/adr/README.md) first

## Walkthroughs

Each guides a person through a process step by step. Read the match before you start, or when asked to walk someone through it.

- Creating a Project: [docs/agents/project-create.md](docs/agents/project-create.md)
- Shipping a change to a Package, the Template or `app-ci.yml`: [docs/agents/release.md](docs/agents/release.md)
- Running a Template upgrade in a Project: [apps/app/docs/agents/template-upgrade.md](apps/app/docs/agents/template-upgrade.md)
- Handling dependency updates: [apps/app/docs/agents/dependency-updates.md](apps/app/docs/agents/dependency-updates.md)
