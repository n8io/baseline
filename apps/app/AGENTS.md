# App

The glossary is [CONTEXT.md](CONTEXT.md). Use its terms for every name. The next line loads it in Claude Code, so it stays alone on its line:

@CONTEXT.md

Run with Node 26 (`.node-version`) and pnpm from `packageManager`.

## Verify

On a fresh cloud machine run `bash scripts/agent-setup.sh` first ([docs/agents/agent-setup.md](docs/agents/agent-setup.md)).

- setup: `pnpm install`
- format: `pnpm format`
- lint + format check + typecheck: `pnpm check` (30 s budget)
- unit tests: `pnpm test` (2 min budget; memory adapters only)
- integration tests: `pnpm test:integration` (4 min budget), one file: `pnpm test:integration <path>`; needs Postgres and Redis (`pnpm dev` starts them)
- most of CI: `pnpm run ci` = check, unit, integration, piece-check (HEAD only, commit first); not oasdiff, migrations, sast, image
- dev server: `pnpm dev` at the URL it prints (Vite's 5173; `PORT` only without the UI): starts Postgres and Redis, migrates, seeds, runs the Worker. `pnpm dev:reset` wipes their data
- build, migrate, seed: `pnpm build`, `pnpm migrate`, `pnpm seed`
- codegen: `pnpm codegen` (after editing a `*-table.ts` file)
- new domain: `pnpm domain-create`
- API check (oasdiff): `pnpm api-check`
- pieces removable: `pnpm piece-check`
- template upgrade: `pnpm template-upgrade`
- glossary aliases: `pnpm glossary-check`

There is no coverage tooling.

Dev, tests, the worker, migrate and seed run TypeScript directly with erasable syntax only. Imports carry the `.ts` extension and use `#imports`, not path aliases.

CI fails a command at its budget. Make the code faster or set a new budget deliberately; never raise it quietly.

## Tests

- A unit test sits beside the file it covers in `src/` or `scripts/`, as `<name>.test.ts` or `<name>-<aspect>.test.ts` (`src/env-memory.test.ts`).
- A test that needs Postgres or Redis names it before `.test` (`invoice-repository.postgres.test.ts`) and runs with `pnpm test:integration`.
- A test that boots a process or spans many modules goes in `test/integration/`, with its setup and fixtures.
- A check of the whole app sits at the app root: `architecture.test.ts`, `structure.test.ts` and the like.
- A test helper sits beside its tests with `test` in its name (`src/ui/routes/router-test-context.ts`).
- A Package's test helpers come from `@n8io/baseline-<package>/testing`. Only a `*.test.ts(x)` file or a file under `test/` imports it (architecture rule A24). Use them and its memory adapter; never copy its internals into a test.
- `structure.test.ts` fails on a test anywhere else (no `test/unit/`) or one reading undeclared app files.
- Domain test files share one import graph (`isolate: false`): keep them free of file-level state.
- Biome reads a helper named `use<Name>` as a React hook and `before` or `after` as a test hook: name helpers otherwise.

## Where new work goes

One Domain per business entity, added with `pnpm domain-create`.

| Kind of work                                      | File                              |
| ------------------------------------------------- | --------------------------------- |
| Entry: exports for outside code, and the scopes   | `index.ts`                        |
| Repository ports                                  | `domain/repositories.ts`          |
| Other ports                                       | `application/ports.ts`            |
| Domain errors                                     | `domain/errors.ts`                |
| Models, input Models, Event schemas (Zod)         | `domain/<domain>.ts`              |
| Rules: pure, one per file, with a test            | `domain/<domain>-<rule>.ts`       |
| One Use case per file, tested on memory adapters  | `application/<domain>-<verb>.ts`  |
| Use cases factory and its type                    | `application/*-use-cases.ts`      |
| A helper two Use cases share                      | `application/<domain>-<thing>.ts` |
| Routes, live streams, Consumers, Schedules, Seeds | `adapters/inbound/`               |
| Port implementations, tables, contract tests      | `adapters/outbound/`              |
| A unit test of one file, beside it                | `<file>.test.ts`                  |

- Outside code imports only `index.ts` and `adapters/*/index.ts`.
- The Domain never imports `adapters/`. Composition roots wire them.
- Use cases apply Rules; adapters hold none.
- Name things generic to specific: the scope, then the subject, then the action or qualifier (`invoiceCreate`, `postgresPoolCreate`, `invoiceRepositoryPostgresCreate`). Architecture rule A23 checks every part of this:
  - An exported name never starts with a verb.
  - Every exported function in a package starts with the package's name, and in a Domain with the Domain's name (`queueConsumerCreate`, `invoiceStaleIs`).
  - A function that builds and returns a thing ends in `Create`. `Repository`, `Schema`, `Routes` and adapter names (`Memory`, `Postgres`, `Redis`) come last before it: `invoiceRepositoryPostgresCreate`, `idSchemaCreate`.
  - A predicate (a `boolean` or type-predicate return) ends in `Is`, `Has` or `Can`: `invoiceDeleteCan`, `postgresUniqueViolationIs`.
  - A file is named as its primary export in kebab case, without a factory's `Create`: `invoice-routes.ts` exports `invoiceRoutesCreate`, `invoice-stale-is.ts` exports `invoiceStaleIs`.
  - Exceptions, each for a reason:
    - A Use case file exports the Use case by its business verb, not as a factory: `invoice-create.ts` exports `invoiceCreate(ports)`.
    - A conversion keeps `From` or `To` and no `Create`: `idFromUuid`, `actorFromClaims`.
    - `ok` and `err` in the result package are unscoped, because every Use case and adapter returns them.
    - Types and glossary-term schemas (`Actor`, `Inbox`) are not functions.
    - React hooks (`use…`), components, React Router's own export names (`loader`, `action`, `links`, `handleError`) and names a library spells are framework names.
- One input, or two strongly coupled inputs (the second may be optional), may stay positional. Three or more inputs take one typed input object (`queueScheduleCreate({ cron, name, run })`). Biome's `useMaxParams` fails on a third parameter but misses `export default function` and type signatures such as ports, so check those by hand; a callback whose shape a library fixes takes a `biome-ignore` that names the library. Test helpers (`*.test.ts(x)`, `*-test-*.ts`) are exempt.
- A read across Domains goes through a Bridge in `src/bridges/`. A reaction goes through an Event.
- UI pages live in `src/ui/`. They import Domains only through `index.ts`.
- `domain/` imports only itself, Zod, `src/id-schema.ts` and the authn, id and result types (A2). Move the rest to a Use case.
- A Use case reads the time from its clock port, never `new Date()` or `Date.now()` (A26).
- Use cases return `err()`; they and `domain/` never throw or catch (A27).
- A table column built with another Domain's id prefix (`postgresIdColumnCreate("team")`) needs that Domain's `deleted` Consumer (A14). `adapters/inbound/` never calls `.openapi(` on an imported model; build its own schema (A25).

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
- a secret cannot come from `.env.schema` and Infisical.

For several Domains at once, one approved plan answers the Domain, term, verb and Event questions it covers: [docs/agents/planning.md](docs/agents/planning.md).

Other hard rules: no `any`; every Biome suppression states a reason, and so does every Semgrep one (`// nosemgrep: <rule-id> -- <reason>`; `.semgrepignore` holds generated paths only); no `@ts-expect-error` or `@ts-ignore` in `src/contexts/**`; every test asserts with `expect()`; Vitest is the only runner.

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
- Track an analytics event after commit, named like the Event for the same change (`invoice.created`). The Domain's analytics port lists every name it sends.
- A scheduled Use case handles everything due as of now, not a fixed batch. One catch-up run must cover any number of missed ticks, and a repeat must change nothing.
- Make cut-off work safe to redo. Delivery is at least once everywhere.
- Reuse an existing shadcn component before making one. Add components only with `pnpm exec shadcn add <name>`. Never write them by hand.

## Env and secrets

- Declare every variable in `.env.schema`. Secrets are `@sensitive` by default.
- In `.env.production` a secret is an `infisical()` reference. Never put a value in a committed file.
- Read `ENV` from `#env`. Never read `process.env`.
- Put dev and test values in `.env.development` and `.env.test`.
- `memory://` URLs are allowed only in development and test.

## Privacy

- Logs, spans, metrics, analytics events and Error reports carry only ids, error codes, class names, counts and timings. Never a Model, an input or error message text.
- Paths and queries never carry personal data. Path parameters are ids.
- Card numbers never enter the app.

## Read when

Read the one that matches before you start.

- A role, a scope, a dev user or a machine-only Use case: [docs/agents/authn.md](docs/agents/authn.md)
- Adding a Domain with `pnpm domain-create` (flags, what it writes): [docs/agents/domain-create.md](docs/agents/domain-create.md)
- A Consumer, an Event or a repository: [docs/agents/events.md](docs/agents/events.md)
- A Domain reading another Domain (a Bridge), or an outcome other Domains wait on: [docs/agents/bridges.md](docs/agents/bridges.md)
- A table, a migration or SQL: [docs/agents/data.md](docs/agents/data.md)
- Adding, testing or removing a Schedule: [docs/agents/schedules.md](docs/agents/schedules.md)
- Adding, changing, testing or removing a page: [docs/agents/ui.md](docs/agents/ui.md)
- Adding a log line, a span, a span attribute or a metric: [docs/agents/tracing.md](docs/agents/tracing.md)
- Deploying a Project or changing how it runs: [docs/agents/deploy.md](docs/agents/deploy.md)
- Running on Kubernetes or several instances (probes, PgBouncer, rollouts): [docs/agents/deploy-kubernetes.md](docs/agents/deploy-kubernetes.md)
- Running a Template upgrade or walking someone through one: [docs/agents/template-upgrade.md](docs/agents/template-upgrade.md)
- A route, a field, a query parameter or an error under `/api/v1` (oasdiff, statuses): [docs/agents/api.md](docs/agents/api.md)
- A dependency, a Dependabot PR or an update walkthrough: [docs/agents/dependency-updates.md](docs/agents/dependency-updates.md)
- Closing what a test, script or helper opens (`await using`): [docs/agents/using.md](docs/agents/using.md)
- Passing a vendor-only setting (Postgres TLS, a Mixpanel region) to a Package: [docs/agents/vendor-settings.md](docs/agents/vendor-settings.md)
- A script that calls the running app (flags, token, waiting, exit code): [docs/agents/scripts.md](docs/agents/scripts.md)
- Removing, restoring or keeping (`piecesKept`) a piece (UI, live, cache, Redis, queue, analytics, error tracking, API docs, SDK, CLI): [docs/agents/pieces.md](docs/agents/pieces.md)
- Publishing the SDK and CLI to npm (versions, first publish): [docs/agents/clients.md](docs/agents/clients.md)
- Planning a build of several Domains (approval up front, parallel PRs): [docs/agents/planning.md](docs/agents/planning.md)
- A fresh cloud machine (Node, Docker, image build behind a proxy): [docs/agents/agent-setup.md](docs/agents/agent-setup.md)
