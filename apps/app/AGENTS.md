# App

@CONTEXT.md

Run with Node 26 (`.node-version`) and the pnpm version pinned in `packageManager`.

## Verify

Commands by role. Integration tests need `docker compose up -d`; `pnpm dev` runs it itself.

- setup: `pnpm install`
- format: `pnpm format`
- lint + format check + typecheck: `pnpm check` (30 s budget)
- unit tests: `pnpm test` (2 min budget; memory adapters only)
- integration tests: `pnpm test:integration` (3 min budget)
- full CI-equivalent: `pnpm run ci` (`pnpm ci` is pnpm's own clean install)
- dev server: `pnpm dev` (starts Postgres and Redis, runs migrate and seed, then the Worker, with health on port 9001, beside the dev server; the Worker restarts when a file it imports changes)
- build: `pnpm build`
- codegen: `pnpm codegen` (run after editing a `spi/*-table.ts` file)
- migrate: `pnpm migrate`
- seed: `pnpm seed`
- new domain: `pnpm domain-create`
- template upgrade: `pnpm template-upgrade`
- glossary warnings: `pnpm glossary-check`

Dev, tests, the worker, migrate and seed run TypeScript directly with erasable syntax only. Imports carry the `.ts` extension and use `#imports`, not path aliases.

When a budget trips, decide again deliberately: make the code faster or set a new budget. Never raise it quietly.

## Tests

- A unit test sits beside the file it covers in `src/` or `scripts/`, as `<name>.test.ts` or `<name>-<aspect>.test.ts` (`src/server-wiring.test.ts`).
- A test that needs Postgres or Redis names it before `.test` (`foo-repository.postgres.test.ts`) and runs with `pnpm test:integration`.
- A test that boots a process or spans many modules goes in `test/integration/`, with its setup and fixtures.
- A check of the whole app sits at the app root: `architecture.test.ts`, `structure.test.ts`, `dockerfile.test.ts` and `env-files.test.ts`.
- A test helper sits beside its tests with `test` in its name (`src/ui/routes/router-test-context.ts`).
- `structure.test.ts` fails on a test anywhere else. There is no `test/unit/`.

## Where new work goes

One Domain per business entity.
Copy the `foo` Domain in `src/domains/foo/` with `pnpm domain-create`.

| Kind of work                                                         | File                                     |
| -------------------------------------------------------------------- | ---------------------------------------- |
| Entry: re-exports what outside code may use, and the Domain's scopes | `index.ts`                               |
| Port types                                                           | `ports.ts`                               |
| Domain errors                                                        | `<domain>-errors.ts`                     |
| Models (Zod schema and inferred type), input Models, Event schemas   | `models/<domain>.ts`                     |
| Rules (pure functions over Models, one per file, with a test)        | `rules/<domain>-<rule>.ts`               |
| One Use case per file, with a test on memory adapters                | `use-cases/<domain>-<verb>.ts`           |
| Use cases factory and its type                                       | `use-cases/<domain>-use-cases-create.ts` |
| HTTP routes, live streams, Consumers, Schedules, Seeds               | `api/`                                   |
| Port implementations, tables, contract tests                         | `spi/`                                   |
| A unit test of one file, beside it                                   | `<file>.test.ts`                         |

- Outside code imports only `index.ts`, `api/index.ts` and `spi/index.ts`.
- The Domain never imports `api/` or `spi/`. Composition roots wire them.
- A Use case applies Rules. The API and the SPI hold no business rules.
- Name things generic to specific: the scope (Domain, package or area), then the subject, then the action or qualifier (`invoiceCreate`, `postgresPoolCreate`, `fooRepositoryPostgres`). An exported name never starts with a verb; architecture rule A23 checks it.
  - A function that builds and returns a thing ends in `Create`. A predicate ends in `Is`, `Has` or `Can` (`authnDataRequestIs`).
  - `Error`, `Repository`, `Schema` and adapter names (`Memory`, `Postgres`, `Redis`) come last.
  - A file is named as its main export, in kebab case: `foo-create.ts` exports `fooCreate`.
  - Exempt: React hooks (`use…`) and components; React Router's own export names (`loader`, `action`, `handleError`); names imported from a library stay as the library spells them.
- A read across Domains goes through a Bridge in `src/bridges/`. A reaction goes through an Event.
- UI pages live in `src/ui/`. They import Domains only through `index.ts`.

### Stop and ask

Stop and ask the user when:

- the work fits no single Domain;
- a glossary term is new or changes meaning, or a new business verb or Event is needed;
- a new Domain is needed (propose a name and a one-line definition);
- a new dependency is needed, including any UI dependency beyond Tailwind, shadcn/ui, `cn()` and lucide;
- a hard rule, its check or a budget would change;
- a second pattern would be added for something that has one;
- a transaction needs a timeout longer than 5 s;
- a migration needs a `destructive.md`;
- the `oasdiff` check would be skipped;
- the app would accept card data;
- the app would start a child process at runtime;
- an OpenTelemetry instrumentation would be added;
- a secret cannot come from `.env.schema` and 1Password.

Other hard rules: no `any`; every Biome suppression states a reason, and so does every Semgrep one (`// nosemgrep: <rule-id> -- <reason>`; `.semgrepignore` holds generated paths only); no `@ts-expect-error` or `@ts-ignore` in `src/domains/**`; every test asserts with `expect()`; Vitest is the only runner.

## Glossary rules

- `CONTEXT.md` is the source of truth for names in code, tests, UI copy, tickets, PRs and commits. Never use an `_Avoid_` alias.
- Never edit `## Architecture`. Propose the change to baseline.
- Ask before adding or changing a term. Give the term, the definition and the `_Avoid_` list. Never add or edit a term the user did not answer.
- The entry lands in the same PR. The PR body has a "Glossary" section listing each change as agreed.
- Removing a Domain removes its glossary entry in the same PR.
- Existing code that uses another word for a term gets a rename ticket, one per term. Do not rename in passing.
- Renames go everywhere, with expand then contract.
- Run `pnpm glossary-check` before a PR and judge each hit.

## Rules no tool checks

- An action calls exactly one write Use case. A loader may call any number of read Use cases across Domains.
- Do one write per Use case where possible.
- Do not make slow outside calls inside a transaction. The 5 s timeout is the only guard.
- A scheduled Use case handles everything due as of now, not a fixed batch. One catch-up run must cover any number of missed ticks, and a repeat must change nothing.
- Make cut-off work safe to redo. Delivery is at least once everywhere.
- Dependabot update PRs merge themselves once CI passes, unless they are major. A major PR needs a human to review and merge it.
- Reuse an existing shadcn component before making one. Add components only with `pnpm shadcn add <name>`. Never write them by hand.

## Env and secrets

- Declare every variable in `.env.schema`. Secrets are `@sensitive` by default.
- A secret's production value is an `op()` reference in `.env.production`. Never put a value in a committed file.
- Read `ENV` from `#env`. Never read `process.env`.
- Put dev and test values in `.env.development` and `.env.test`.
- `memory://` URLs are allowed only in development and test.

## Privacy

- Logs, spans and metrics carry only ids, error codes, class names, counts and timings. Never a Model, an input or error message text.
- Paths and queries never carry personal data. Path parameters are ids.
- Card numbers never enter the app. Accepting card data is a stop-and-ask.
- At deploy time, recommend the OpenTelemetry Collector `redaction` processor as a second line of defence.

## Read when

These docs load only when the task needs them. Read the one that matches before you start.

- Adding a Consumer, an Event, a Bridge or a repository: [docs/agents/events-and-bridges.md](docs/agents/events-and-bridges.md)
- Touching a table, a migration or SQL: [docs/agents/data.md](docs/agents/data.md)
- Adding a log line, a span, a span attribute or a metric: [docs/agents/tracing.md](docs/agents/tracing.md)
- Deploying a Project or changing how it runs: [docs/agents/deploy.md](docs/agents/deploy.md)
- Running a Template upgrade, or walking someone through one: [docs/agents/template-upgrade.md](docs/agents/template-upgrade.md)
- Handling a Dependabot pull request, or walking someone through updates: [docs/agents/dependency-updates.md](docs/agents/dependency-updates.md)
