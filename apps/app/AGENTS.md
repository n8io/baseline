# App

Glossaries: [CONTEXT.md](CONTEXT.md), shared, and each context's own, listed in [CONTEXT-MAP.md](CONTEXT-MAP.md). The next line loads the first; keep it alone:

@CONTEXT.md

Run with Node 26 (`.node-version`) and pnpm from `packageManager`.

## Verify

On a fresh cloud machine run `bash scripts/agent-setup.sh` first (agent-setup.md).

- setup: `pnpm install`
- format: `pnpm format`
- lint + format check + typecheck: `pnpm check` (30 s budget)
- unit tests: `pnpm test` (2 min budget; memory adapters only)
- integration tests: `pnpm test:integration` (4 min budget), one file: `pnpm test:integration <path>`; needs Postgres and Redis (`pnpm dev` starts them)
- most of CI: `pnpm run ci` = check, unit, integration, piece-check (HEAD only, commit first); not oasdiff, migrations, sast, image
- dev server: `pnpm dev` at the URL it prints (`<instance>.localhost:<PORT>`) runs Postgres, Redis, migrate, seed, Worker. `pnpm dev:reset` wipes data, `dev:prune` removed worktrees'
- build, migrate, seed: `pnpm build`, `pnpm migrate`, `pnpm seed`
- codegen: `pnpm codegen` (after editing a `*-table.ts` file)
- new context: `pnpm context-create`; new Aggregate: `pnpm aggregate-create`
- API check (oasdiff): `pnpm api-check`
- pieces removable: `pnpm piece-check`
- template upgrade: `pnpm template-upgrade`
- glossary: `pnpm glossary-check`

There is no coverage tooling.

Dev, tests, the Worker, migrate and seed run TypeScript directly, erasable syntax only. Imports carry the `.ts` extension and use `#imports`, not path aliases.

CI fails a command at its budget. Make the code faster or set a new budget on purpose, never quietly.

## Tests

- A unit test sits beside the file it covers in `src/` or `scripts/`, as `<name>.test.ts` or `<name>-<aspect>.test.ts` (`src/env-memory.test.ts`).
- A test that needs Postgres or Redis names it before `.test` (`invoice-repository.postgres.test.ts`) and runs with `pnpm test:integration`.
- A test that boots a process or spans many modules goes in `test/integration/`, with its setup and fixtures.
- A whole-app check sits at the app root (`architecture.test.ts`).
- A test helper sits beside its tests with `test` in its name (`src/ui/routes/router-test-context.ts`).
- A Package's test helpers come from `@n8io/baseline-<package>/testing`, imported only by `*.test.ts(x)` and `test/` files (A24). Use them and its memory adapter; never copy its internals.
- Test a context through its interface on memory connections (tests.md).
- Biome reads a helper named `use<Name>` as a React hook and `before` or `after` as a test hook: name helpers otherwise.

## Where new work goes

One context per business area, holding its Aggregates (context-create.md).

| Kind of work                                      | File                                 |
| ------------------------------------------------- | ------------------------------------ |
| Entry: exports for outside code, and the scopes   | `index.ts`                           |
| Repository ports                                  | `domain/repositories.ts`             |
| Other ports                                       | `application/ports.ts`               |
| Errors the context returns                        | `domain/errors.ts`                   |
| Aggregate: schemas, transitions, specifications   | `domain/<aggregate>.ts`              |
| Domain service: logic over several Aggregates     | `domain/<name>.ts`                   |
| One Use case per file, tested on memory adapters  | `application/<aggregate>-<verb>.ts`  |
| Use cases factory and its type                    | `application/*-use-cases.ts`         |
| A helper two Use cases share                      | `application/<aggregate>-<thing>.ts` |
| Routes, streams, Event handlers, Schedules, Seeds | `adapters/inbound/`                  |
| Port implementations, tables, contract tests      | `adapters/outbound/`                 |
| Each error's HTTP status, for routes and pages    | `<aggregate>-error-status.ts`        |
| A test through the context's interface            | `<file>.test.ts`                     |

- Outside code imports only `index.ts`, the context's one interface (A5).
- `domain/` and `application/` never import `adapters/`; `index.ts` wires them.
- Only an Aggregate's transitions make or change it (A29); adapters hold no business logic.
- Name things generic to specific: prefix, subject, then action or qualifier (`invoiceCreate`, `postgresPoolCreate`, `invoiceRepositoryPostgresCreate`). A23 checks it:
  - An exported name never starts with a verb.
  - Every exported function in a Package starts with its Package's name, or in a context with its context's or Aggregate's name (`queueConsumerCreate`, `invoiceStaleIs`).
  - A function that builds and returns a thing ends in `Create`. `Repository`, `Schema`, `Routes` and adapter names (`Memory`, `Postgres`, `Redis`) come last before it: `invoiceRepositoryPostgresCreate`, `idSchemaCreate`.
  - A predicate (a `boolean` or type-predicate return) ends in `Is`, `Has` or `Can`: `invoiceDeleteCan`, `postgresUniqueViolationIs`. A method or option callback keeps the `isAlive()` form.
  - A file is named after its primary export without `Create` (`invoice-routes.ts` has `invoiceRoutesCreate`) or the subject its exports share (`cursor.ts`). Port adapters are `<port>.memory.ts` and `<port>.postgres.ts` (A19 needs it), shared cases `<port>.contract.ts`.
  - Exceptions:
    - A Use case file exports the Use case by its business verb, not as a factory: `invoice-create.ts` exports `invoiceCreate(ports)`. So a new Aggregate comes from `invoiceNew`.
    - A conversion keeps `From` or `To` and no `Create`: `idFromUuid`, `actorFromClaims`.
    - `ok` and `err` (result Package) are unscoped: every Use case and adapter returns them.
    - Types and schemas are not functions: a schema that is its type is PascalCase (`Invoice`), any other camelCase (`invoiceCreated`, `invoiceCached`).
    - React hooks (`use…`), components, React Router's own export names (`loader`, `action`, `links`) and names a library spells are framework names.
- Up to two positional inputs (the second strongly coupled, maybe optional); three or more take one typed object (`queueScheduleCreate({ cron, name, run })`). Biome's `useMaxParams` misses `export default function` and type signatures; a callback whose shape a library fixes takes a `biome-ignore` naming the library. Test helpers (`*.test.ts(x)`, `*-test-*.ts`) are exempt.
- A read across contexts goes through an ACL in `adapters/outbound/`. A reaction is an Event.
- UI pages live in `src/ui/`. They import contexts only through `index.ts`.
- `domain/` imports only itself, Zod, `src/id-schema.ts`, the result Package and the authn and id types (A2).
- A Use case reads the time from its clock port, never `new Date()` or `Date.now()` (A26).
- Use cases return `err()`; they and `domain/` never throw or catch (A27), but for a bug under `// unreachable:` (data.md).
- A table column built with another context's id prefix (`postgresIdColumnCreate("order")`) needs that context's `deleted` Event handler (A14). `adapters/inbound/` never calls `.openapi(` on a schema it imports; build its own (A25).

### Stop and ask

Stop and ask the user when:

- the work fits no single context;
- a glossary term is new or changes meaning, or a new business verb or Event is needed;
- a new context is needed (propose a name and a one-line definition);
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

For several contexts at once, one approved plan answers the questions it covers (planning.md).

Other hard rules: no `any`; every Biome suppression states a reason, and so does every Semgrep one (`// nosemgrep: <rule-id> -- <reason>`; `.semgrepignore` holds generated paths only); no `@ts-expect-error` or `@ts-ignore` in `src/contexts/**`; every test asserts with `expect()`; no `vi.mock`, `vi.fn`, `vi.spyOn` or fake timers; Vitest is the only runner.

## Glossary rules

- Names in code, tests, UI copy, tickets, PRs and commits come from the glossaries. No `_Avoid_` alias, nor an upstream context's term outside adapters.
- Never edit the shared `CONTEXT.md`; propose changes to baseline.
- Ask before adding or changing a term or a context, giving the term, its definition and `_Avoid_` list. Never add one the user did not answer.
- The entry lands in the same PR, listed in its "Glossary" section.
- A context's `CONTEXT-MAP.md` row comes before `pnpm context-create` and goes with the context.
- Code using another word for a term gets a rename ticket per term, never a rename in passing. Renames go everywhere, expand then contract.
- Run `pnpm glossary-check` before a PR and judge each hit.

## Rules no tool checks

- An action calls exactly one write Use case. A loader may call any number of read Use cases across contexts.
- Do one write per Use case where possible.
- Do not make slow outside calls inside a transaction. The 5 s timeout is the only guard.
- Track an analytics event after commit, named like the Event for the same change (`invoice.created`). The Aggregate's analytics port lists every name it sends.
- A scheduled Use case handles everything due as of now, not a fixed batch: one run covers any number of missed ticks, and a repeat changes nothing.
- Make cut-off work safe to redo. Delivery is at least once everywhere.
- Reuse a shadcn component before making one; add one only with `pnpm exec shadcn add <name>`, never by hand.

## Env and secrets

- Declare every variable in `.env.schema`. Secrets are `@sensitive` by default.
- In `.env.production` a secret is an `infisical()` reference. Never put a value in a committed file.
- Read `ENV` from `#env`. Never read `process.env`.
- Put dev and test values in `.env.development` and `.env.test`.
- `memory://` URLs are allowed only in development and test.

## Privacy

- Logs, spans, metrics, analytics events and Error reports carry only ids, error codes, class names, counts and timings. Never an Aggregate, an input or error message text.
- Paths and queries never carry personal data. Path parameters are ids.
- Card numbers never enter the app.

## Read when

Read the one that matches before you start.

- A role, a scope, a dev user or a machine-only Use case: [docs/agents/authn.md](docs/agents/authn.md)
- A new context, Aggregate, Seed, transition or Use case; one Aggregate per transaction: [docs/agents/context-create.md](docs/agents/context-create.md)
- An Event handler or a Domain event: [docs/agents/events.md](docs/agents/events.md)
- A context reading another (an ACL), or a saga across contexts: [docs/agents/acl.md](docs/agents/acl.md)
- A table, a repository, a list, a migration, SQL or a cached read: [docs/agents/data.md](docs/agents/data.md)
- Adding, testing or removing a Schedule: [docs/agents/schedules.md](docs/agents/schedules.md)
- Adding, changing, testing or removing a page: [docs/agents/ui.md](docs/agents/ui.md)
- Adding a log line, a span, a span attribute or a metric: [docs/agents/tracing.md](docs/agents/tracing.md)
- Deploying a Project or changing how it runs: [docs/agents/deploy.md](docs/agents/deploy.md)
- Running on Kubernetes or several instances (probes, PgBouncer, rollouts): [docs/agents/deploy-kubernetes.md](docs/agents/deploy-kubernetes.md)
- Running a Template upgrade or walking someone through one: [docs/agents/template-upgrade.md](docs/agents/template-upgrade.md)
- A route, a field, a query parameter or an error under `/api/v1`: [docs/agents/api.md](docs/agents/api.md)
- A dependency, a Dependabot PR or an update walkthrough: [docs/agents/dependency-updates.md](docs/agents/dependency-updates.md)
- Closing what a test, script or helper opens (`await using`): [docs/agents/using.md](docs/agents/using.md)
- A context's tests: [docs/agents/tests.md](docs/agents/tests.md)
- Passing a vendor-only setting (Postgres TLS, a Mixpanel region) to a Package: [docs/agents/vendor-settings.md](docs/agents/vendor-settings.md)
- A script that calls the running app (flags, token, waiting, exit code): [docs/agents/scripts.md](docs/agents/scripts.md)
- Removing, restoring or keeping (`piecesKept`) a piece: [docs/agents/pieces.md](docs/agents/pieces.md)
- Using, publishing or installing the SDK and CLI: [docs/agents/clients.md](docs/agents/clients.md)
- Planning a build of several contexts: [docs/agents/planning.md](docs/agents/planning.md)
- A fresh cloud machine (Node, Docker, image build behind a proxy): [docs/agents/agent-setup.md](docs/agents/agent-setup.md)
