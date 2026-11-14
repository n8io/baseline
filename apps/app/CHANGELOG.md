# app

## 8.0.0

### Major Changes

- de5283b: The architecture rules allow what Rules need and catch what they missed.
  - A2: a Rule may import other Rules of its Domain, and the types (`import type`) of `@n8io/baseline-id` and `@n8io/baseline-result`, so a Domain stops copying a Rule or a result type.
  - A14: another Domain's id is found by the id prefix of the column (`postgresIdColumnCreate("team")("proposer_team_id")`), not only by a column named `<domain>_id`. A table that holds such a column without that Domain's `deleted` Consumer now fails.
  - A25 (new): `api/` never calls `.openapi(` on a schema it imports from `models/` or the Domain's `index.ts`. Build the API's own schema (`z.object({ id: Foo.shape.id }).openapi("FooResponse")`).
  - The `migrations` job's destructive check now includes `DROP INDEX`, so a new migration with it needs a `destructive.md`.
  - `docs/agents/tracing.md` lists the attribute shapes with another Domain's id and the span names of one Event hop; `data.md` names the `destructive.md` file.

  To upgrade a Project: take `architecture-test-rules.ts`, `architecture.test.ts` and `architecture-test-samples/` from the Template. Run `pnpm test architecture.test.ts`; fix an A14 failure by adding the other Domain's `deleted` Consumer, and an A25 failure by building the API schema from the Model's `shape` instead of calling `.openapi(` on the Model. The stricter `migrations` check arrives with the next `app-ci.yml@v<major>`.
- db36be7: The memory issuer (`memory://`) now models your app's roles and machine clients, and its tokens work at every Server that shares `AUTHN_SECRET`.
  - `memoryUsers: { id, name, scopes }[]` replaces `memoryAdminScopes`. The sign-in page offers one button per entry; without it, one `dev-user` without scopes.
  - `memoryClients: { id, scopes }[]` and `POST /auth/token`, the client-credentials grant (memory issuer only; 404 with an OIDC provider). A requested `scope` must be a subset of the client's (else 400 `invalid_scope`).
  - `authnMemoryTokenFetch({ url, clientId, scopes })` in the main entry fetches a machine token from a served app, for scripts and dev tools, so they no longer import `/testing`.
  - The memory issuer signs HS256 with a key derived from `secret` instead of a fresh ES256 key per process, so a token signed at one pod verifies at the next. A refresh re-reads the user's `memoryUsers` entry, so a changed scope list takes effect at the next refresh and a removed user is signed out.
  - `/testing`: `authnTestSignIn({ who })` takes a `memoryUsers` id (`"dev-admin"`, not `"admin"`), and the new `authnTestBearerCreate({ actorFromClaims })` gives a route test an `Authn` and `tokenFor(actor)`.

  To upgrade a Project: in `src/server.ts` replace `memoryAdminScopes: [...]` with `memoryUsers: [{ id: "dev-user", name: "Dev user", scopes: [] }, { id: "dev-admin", name: "Dev admin", scopes: [...] }]`, keeping your scope list and the `// domain-create: scopes` marker inside the Dev admin's `scopes`, and add any role or machine client you need. In `src/authn.ts` omit `"memoryUsers"` instead of `"memoryAdminScopes"`. Every `who: "admin"` or `who: "user"` posted to `/auth/sign-in` or passed to `authnTestSignIn` becomes `"dev-admin"` or `"dev-user"`; `integrationSignIn(url, who)` keeps taking `"admin"` or `"user"`. A script that calls a running app lists its client in `memoryClients` and gets its token with `authnMemoryTokenFetch`.
- 9c4dc01: One place builds every Domain's Use cases. The new `src/use-cases.ts` exports `domainsUseCasesCreate(connections)`, which builds each Domain's traced Use cases in order (a Domain that reads another after it, with its Bridge) and returns `{ fooUseCases, ... }`; `DomainsUseCases` is its type. `src/server.ts`, `src/worker.ts`, `src/seed.ts` and the page tests call it, and `seedsRun` and `uiLoadContextCreate` take `DomainsUseCases`, so no Composition root calls a `*PortsCreate` or wires a Bridge any more. `docs/agents/events-and-bridges.md` is split: `events.md` (Consumers, the Event key, shape changes, Aggregates, unchanged) and a new `bridges.md` (the reader port, `<Domain>Readers` as the required second argument of `<domain>PortsCreate`, the Bridge file named after its export, its memory fake `<domain><Target>ReaderMemoryCreate`, the Bridge test on the target's memory ports, build order, lists, the window between a read and a commit, and Outcome Events). Architecture rule A18 now also checks `src/use-cases.ts`. `domain-create` handles a statement whose every argument names the Domain, and gives a file whose imports all went a blank line after them.

  To upgrade a Project: `pnpm template-upgrade` adds `src/use-cases.ts` with its `domains-start`/`domains-end` pair empty, and changes only the markers in `worker.ts` (likely a conflict). `server.ts`, `seed.ts` and `src/ui/context.ts` come through unchanged, because their Domain lines sit inside pairs the render empties, so the Project still compiles in the old shape. Move it to the new one by hand before the next `pnpm domain-create`, which otherwise stops with `missing marker "// domain-create: use-cases"`:
  1. In `src/use-cases.ts`, between the pair, paste the skeleton and move each `const <domain>UseCases = telemetryUseCasesTrace(...)` from `server.ts` into it above `// domain-create: use-cases`, in the order the Bridges need, with `<domain>UseCases,` above `// domain-create: use-cases-returned`; add the imports it needs:

     ```ts
     export const domainsUseCasesCreate = (connections: Connections) => {
     	// domain-create: use-cases
     	return {
     		// domain-create: use-cases-returned
     	};
     };
     export type DomainsUseCases = ReturnType<typeof domainsUseCasesCreate>;
     ```

  2. `server.ts`: inside its first pair, `const useCases = domainsUseCasesCreate(connections);` and the memory seed becomes `await seedsRun(useCases);`; routes and live routes take `useCases.<domain>UseCases`; `getLoadContext` passes `useCases` between its pair. `worker.ts`: put `// domain-create: domains-start`, `const useCases = domainsUseCasesCreate(connections);` and `// domain-create: domains-end` where the Use cases were built, and call Consumers and Schedules with `useCases.<domain>UseCases`. `seed.ts`: `seedsRun(useCases: DomainsUseCases)`, and its main block's pair holds `await seedsRun(domainsUseCasesCreate(connections));`. `src/ui/context.ts`: `uiLoadContextCreate(c, useCases: DomainsUseCases)` between its pair. Delete every `<domain>PortsCreate` call and copy left in those four files.
  3. Delete the markers nothing writes at any more: `// domain-create: bridges`, `seed-context`, `seed-types`, `context-types`, the `context` marker in `server.ts`'s `getLoadContext`, and the `use-cases` markers in `server.ts`, `worker.ts` and `seed.ts`.
  4. A Domain that reads another: give its `<domain>PortsCreate` a required second argument `readers: <Domain>Readers` (`Pick<<Domain>Ports, "<domain><Target>Reader">`), name the Bridge file after its export (`src/bridges/<domain>-<target>-reader.ts`), and replace any reader spread into `connections` or defaulted inside `*PortsCreate`. `docs/agents/bridges.md` shows each file.
  5. Tests that built `<domain>UseCasesCreate(<domain>PortsCreate(connections))` for pages can use `domainsUseCasesCreate(connections).<domain>UseCases`, which wires the Bridges the same way the Server does; Foo's page tests now do.
- 4294efa: Foo's reads use the Packages' helpers, and the cursor is typed.
  - `src/cursor.ts`: `Cursor<P>` is `{ id, kind: "text" | "number" | "date", value }` (it was `{ k, id }`), so a cursor remembers the sort that wrote it. `cursorDecode({ cursor, kind, prefix })` takes one object and answers `null` for a cursor that does not decode, comes from another sort, has an id with another prefix or an id that is no id, or holds a value that is not its kind (a date that is not exactly what `toISOString` writes). That is the first page, where a cursor from the name sort used to answer 500 on the date sort. New `cursorMemoryPage({ after, descending, items, kind, limit, sortValue })` pages a list in memory in the order of `postgresKeysetCreate`, so the memory adapter and Postgres agree. Cursors written by an earlier release (`k`) read as none once, so a link shows the first page.
  - Foo's Postgres repository pages with `postgresKeysetCreate` (no `::timestamptz` cast or hand-built row comparison any more), and its memory repository with `cursorMemoryPage`.
  - Foo's cache is `cacheCreate(store, { keyOf: (foo) => foo.id, prefix: "foo", schema: fooCached })` in `spi/index.ts` and `spi/foo-ports.memory.ts`; `spi/foo-cache.ts` is gone and its test moved to `spi/index.test.ts`.
  - `fooPortsMemoryCreate().state` records `liveUpdatesSent` and `analyticsTracked` (with whether the foo was committed when it was tracked), so a Domain's live and analytics tests read them instead of rebuilding a recorder port. `fooPortsMemoryCreate` no longer lists its return type, so `state` carries them.

  To upgrade a Project: Foo is not in a Project, so apply this to each Domain by hand. Take `src/cursor.ts` and `src/cursor.test.ts` from the Template. In each Domain's Postgres repository replace the keyset condition and `orderBy` with `postgresKeysetCreate({ after, descending, idColumn, kind, sortColumn })` (`kind` `"text"` for a text sort, `"date"` for a `timestamptz` one, `"number"`), decode with `cursorDecode({ cursor, kind, prefix })` and encode with `{ id, kind, value }`; in the memory repository replace the sort and filter with `cursorMemoryPage`. Replace `spi/<domain>-cache.ts` with the `cacheCreate` call above. Copy the `liveUpdatesSent` and `analyticsTracked` lines of `foo-ports.memory.ts` into your Domain's, and read them in its live and analytics tests. A sort column must be NOT NULL, and a `date` column must hold at most milliseconds (written from a JS `Date`).
- 02e9aa4: Foo's writes are safe under concurrency, and Use cases read the time from a Clock port.
  - `FooRepository.findByIdForUpdate(id)` reads and locks the row (Drizzle `.for("update")`; memory: the same read). `fooUpdate` and `fooDelete` read through it inside the transaction, so a concurrent write waits instead of being undone (a Schedule's archive between a rename's read and write, two deletes publishing `foo.deleted` twice).
  - `update` returns `FooNotFoundError` when the row is gone instead of throwing, and `delete` returns `Result<void, FooNotFoundError>` instead of `void`: a race answers 404, not 500. Each write has its own error type: `FooRepositoryInsertError`, `FooRepositoryUpdateError`, `FooRepositoryDeleteError`.
  - `FooTransaction` is one signature, `(work, inbox?)`, instead of two overloads, so explicit type arguments work with an inbox (`fooTransaction<void, never>(work, inbox)`). A conditional type on the inbox parameter accepts an inbox only when the work's value may be `undefined`, since a repeat returns `ok(undefined)`.
  - `FooForbiddenError`'s `fooId` is optional (`null` when the Actor may not create a foo at all).
  - New `src/clock.ts`: `Clock`, `clockSystemCreate()`, `clockMemoryCreate(start?)` with `set` and `advance`. `FooPorts.fooClock`; `fooPortsMemoryCreate()` returns the memory `clock` beside `ports` and `state`. Architecture rule A26 (new) fails `new Date()` or `Date.now()` in `use-cases/`. **Clock** is in `CONTEXT.md`.
  - `docs/agents/data.md`: Locking and limits, An Aggregate with a child table, `pnpm codegen --name`, codegen before a new table's Postgres tests, split drops from adds, UUID columns and prefixed ids.

  To upgrade a Project: take `src/clock.ts`, `src/clock.test.ts`, `architecture-test-rules.ts`, `architecture.test.ts` and `architecture-test-samples/` from the Template. Then apply the Foo changes to each Domain by hand (`git diff app@7.1.0 app@8.0.0 -- apps/app/src/domains/foo` shows them): in `ports.ts` add `findByIdForUpdate`, the per-operation error types, the `Result` from `update` and `delete`, the one-signature `<Domain>Transaction` and `<domain>Clock: Clock`; in `spi/` implement them in both repositories, add `<domain>Clock` to `spi/index.ts` (`clockSystemCreate()`) and `<domain>-ports.memory.ts` (`clockMemoryCreate()`), and accept `inbox?: Inbox | null` in both transactions; add the contract cases for a missing row to `<domain>-repository.contract.ts`, and copy `use-cases/foo-update.postgres.test.ts` as the Domain's race test; in `use-cases/` read through `findByIdForUpdate` before a write, return the repository's error from `delete`, and replace `new Date()` with `ports.<domain>Clock.now()`. A test that used `vi.useFakeTimers()` for the time sets the memory clock instead. Run `pnpm test architecture.test.ts` to find what A26 still flags.
- caddcd4: Piece removal can no longer rot. `pnpm piece-check [piece...]` removes each installed piece on a throwaway worktree of `HEAD` and runs `pnpm check` and `pnpm test` on the result; the new `pieces` job in `app-ci.yml` runs it and is a required check (`ci / pieces`). `pnpm piece-remove` now runs `pnpm check` itself: when it fails, the command undoes the removal, lists the files that use the piece outside its markers, and exits 1, instead of dying in Biome with half the tree edited. It also deletes a test file left with no test, and `redis` now drops `REDIS_HOST_PORT` from `.env.schema`. `structure.test.ts` fails on a `piece-start` without its `piece-end` or on blocks that cross. `pnpm template-upgrade` stops at once when `.template.json` already names the target release.

  To upgrade a Project: take `scripts/piece-check.ts`, `scripts/piece-remove.ts`, `scripts/template-upgrade.ts` and `structure.test.ts` from the Template and add `"piece-check": "node scripts/piece-check.ts"` to `package.json`. Then run `pnpm piece-check`: new code that uses a piece outside its `// piece-start: <piece>` and `// piece-end: <piece>` lines fails it, naming the files. Wrap that code in markers, or, for a piece this Project will never remove, list it in `.template.json` as `"piecesKept": ["live"]` and `piece-check` skips it. Add `ci / pieces` to the default branch's required checks. A file with piece blocks in its exports starts with `// biome-ignore-all assist/source/organizeImports: piece markers keep each piece's exports together`; the Template's Foo `api/index.ts` shows it.
- 94c4bbe: The Server reports alive only after its Postgres check, drains on its own variable, and development has a user per role and a machine client.
  - `src/server.ts` calls `connectionsOpen` before it opens the health port, as the Worker does, so `/livez` never answers for a Server that cannot reach Postgres (a startup probe on `/livez` now proves the check passed).
  - `SHUTDOWN_DRAIN_DELAY_MS` (new, optional) sets how long the Server keeps serving after SIGTERM; unset means 5000. `.env.development` and `.env.test` set it to 0. The drain no longer depends on `APP_ENV`, so a prod-like run under `APP_ENV=test` can have the production drain.
  - `src/authn.ts` exports `authnMemoryUsersCreate(scopes)` (Dev user without scopes, Dev admin with all) and `authnMemoryClientsCreate(scopes)` (`dev-client`, for `authnMemoryTokenFetch`). `src/server.ts` builds one `scopes` list and passes it to both.
  - `connectionsOpen({ role, urls })` takes optional `urls: { cache, database }`, so a test can open a real database with the cache in memory. `databaseOpen` takes `{ role, url }`.
  - New `docs/agents/authn.md` (roles, scopes, machine clients, dev users); `deploy-kubernetes.md` gains PgBouncer settings, the load balancer check, the memory issuer on a scaled stack and the drain variable.

  To upgrade a Project: in `src/server.ts` move `const connections = await connectionsOpen(...)` above `healthServerCreate`; replace `drainDelayMs: envLocal ? 0 : 5_000` with `ENV.SHUTDOWN_DRAIN_DELAY_MS ?? 5_000`; replace the inline `memoryUsers` with a `const scopes: string[] = [...<domain>Scopes, // domain-create: scopes]` list and `memoryClients: authnMemoryClientsCreate(scopes)`, `memoryUsers: authnMemoryUsersCreate(scopes)`, copying the two functions from the Template's `src/authn.ts` (add one dev user per role there). Add `SHUTDOWN_DRAIN_DELAY_MS` to `.env.schema` (the Template's lines) and `SHUTDOWN_DRAIN_DELAY_MS=0` to `.env.development` and `.env.test`. In `src/connections.ts` take `urls` and change `databaseOpen` as the Template does; a test that opened `databaseOpen(role)` passes `{ role, url }`. Copy `docs/agents/authn.md` and its "Read when" line.
- a1fc95b: Two Projects can run side by side on one machine, and integration tests touch only their own database. `compose.yaml` publishes Postgres, Redis, the Server and the health port on `POSTGRES_HOST_PORT`, `REDIS_HOST_PORT`, `SERVER_HOST_PORT` and `HEALTH_HOST_PORT` (new items in `.env.schema`; a Project gets its own, derived from its name, in 20000 to 29999), names its compose project, and prefixes image names with `IMAGE_REGISTRY`. `pnpm dev` and the new `pnpm dev:reset` run `varlock run -- docker compose -p <project>`. Integration tests read `INTEGRATION_DATABASE_URL` and `INTEGRATION_CACHE_URL` (not `DATABASE_URL` and `CACHE_URL`); unit tests are pinned to `memory://`; the template database is `<project>_template` and is dropped only when it carries the Project's comment.

  To upgrade a Project: take `compose.yaml`, `vitest.config.ts`, `test/integration/global-setup.ts`, `test/integration/integration-database.ts` and the new `test/integration/integration-template.ts` from the Template, then set your name in `name:` and in each `-p`. Add the four `*_HOST_PORT` items and `IMAGE_REGISTRY` to `.env.schema` with ports of your own (any four free ports; the Template's 5432, 6379, 3000 and 9000 clash with another Project), and build `DATABASE_URL` and `CACHE_URL` in `.env.development` from them (`localhost:${POSTGRES_HOST_PORT}`). Change the `dev` script and add `dev:reset` as in the Template's `package.json`. In CI, set `INTEGRATION_DATABASE_URL` and `INTEGRATION_CACHE_URL` on the step that runs `pnpm test:integration` (`app-ci.yml` does it for you). Run compose through `pnpm dev` or `varlock run -- docker compose -p <project>`, never bare `docker compose`.

### Minor Changes

- 73ab655: `pnpm domain-create` makes the Domain you ask for, and its output reads as success.
  - `--bare` copies only the core (Model, ports, errors, create/get/list/update/delete, the API, repository with its contract test, transaction, created and deleted Events). `--analytics`, `--cache`, `--live`, `--pages`, `--schedule` and `--seed` add one part each, wiring included. Without `--bare` it copies everything, as before.
  - `--reads <domain>` (repeatable) writes the reader port, `readers` as the required second argument of `<name>PortsCreate`, its memory fake, the Bridge in `src/bridges/` with its test, and the wiring in `src/use-cases.ts`. It refuses a Domain that does not exist or already reads the new one.
  - `--help` / `-h` print what each flag writes; an unknown flag prints the usage and exits 1, with no stack trace. Every script in `scripts/` stops with "needs Node 26, found <version>" on an older Node.
  - Scripts keep a working command's stderr out of the terminal (no detached-HEAD advice, no "error: could not apply" from a Template fetch); a failing command's error still carries it. domain-create runs `pnpm check` and `pnpm test` quietly and ends with the next steps for the flags used, naming `pnpm codegen --name <name>_create` until the Domain has a migration.
  - New page `docs/agents/domain-create.md`: add the `CONTEXT.md` entry first, what each flag writes, and what it never writes (business Rules, Consumers, outcome Events). `bridges.md` now says `--reads` writes the Bridge.

  To upgrade a Project: take `scripts/` from the Template (the Template upgrade does). Domains a Project already has are unchanged; the Foo changes in this release are domain-create markers only, so there is nothing to apply by hand.
- 64cd00e: Problem `code` is an extensible enum. `httpErrorResponsesCreate` now documents `code` as a string with `x-extensible-enum` listing its known values, so a route can answer a new error code on a status it already declares without oasdiff reporting `response-property-enum-value-added`. `types` also takes a `readonly` list (an `as const` array no longer fails with TS4104). The Template gains `pnpm api-check` (`scripts/api-check.ts`: oasdiff on `origin/main` against your working tree, the same command as CI's `oasdiff` job) and `docs/agents/api.md`, "Changing an API shape"; CI's `oasdiff` job now runs `pnpm api-check`.

  To upgrade a Project: every response's `code` changes from `enum` to `x-extensible-enum`, which oasdiff 1.35.0 reports as `response-property-became-not-enum` (an error) once per error response. `pnpm api-check` and CI's `oasdiff` job read the `main` document with the old closed list as the open one, so the upgrade PR passes without an ignore file; nothing to do. Apply the Template's `scripts/api-check.ts`, the `api-check` script in `package.json` and `docs/agents/api.md` if `pnpm template-upgrade` conflicts on them. Foo's routes are unchanged.
- 3c2a8e3: A Domain's entry exports its error statuses and its "can" predicates, so a page copies neither.
  - `src/domains/foo/foo-error-status.ts` (moved from `api/`, a Domain root may now hold `<domain>-error-status.ts`) is typed against `FooError["type"]` and exported from `index.ts` with `fooUpdateCan` and `fooDeleteCan`. The routes still check it against `HttpErrorStatus<FooError>`.
  - `foo-detail.tsx` shows the update form and the Delete control only when the Rule allows them, and takes every Foo error status from `fooErrorStatus`.

  Foo is not in a Project, so apply this by hand: move your `api/<domain>-error-status.ts` to the Domain root, export it and your `<domain>UpdateCan`-style Rules from `index.ts`, and use them in your pages. Take `structure.test.ts` from the Template.
- b02a1a8: Tools are quieter and faster. `glossary-check` reads only comments and string literals in code (it skips migrations, JSON, JSX element names and `kind:` values), so it stops warning about identifiers. `pnpm check` runs `varlock codegen` and `react-router typegen` (after wiping `.react-router/types`), then Biome and `tsc`, and reports both before it exits non-zero; `pnpm format` is `biome check --write .`. Domain tests run in their own `unit-domains` Vitest project that shares one module graph (`isolate: false`), so the unit job fits its budget with many Domains. `lucide-react` is a dependency (the icon library `components.json` names), and `piece-remove ui` removes it. `.env.development` no longer sets `OTEL_EXPORTER_OTLP_ENDPOINT` (no collector runs by default; set it in `.env.development.local` with `--profile telemetry`). The telemetry integration tests set `OTEL_SDK_DISABLED=false` for their processes. Biome's `useMaxParams` is off for `*.test.ts(x)` and `*-test-*.ts`. Integration setup stops with "build/ is older than src/..." when a source file is newer than the build. Green runs print no error-level lines.

  To upgrade a Project: take `scripts/glossary-check.ts`, `scripts/check.ts`, `scripts/template-render.ts` and `scripts/template-upgrade.ts` from the Template, set `check` to `node scripts/check.ts` and `format` to `biome check --write .`, add the `unit-domains` project from the Template's `vitest.config.ts` (exclude `src/domains/**/*.test.ts` from `unit`) and `--project unit-domains` to the `test` script, add `lucide-react`, add the `overrides` entry to `biome.json`, and remove the `OTEL_EXPORTER_OTLP_ENDPOINT` line from `.env.development` if no collector runs.
- 1aa69e0: Two new agent docs, each with a "Read when" line in `AGENTS.md`:
  - `docs/agents/schedules.md`: a Schedule's file pair (`<domain>Schedule` and `<domain>ScheduleCreate`) and its Actor, the `schedules` markers in `src/migrate.ts`, `src/worker.ts` and `.env.schema`, how `SCHEDULE_<NAME>` is named and where it acts, two Schedules in one Domain, "due" work as one repository method held equal by the contract test, catch-up and repeats, and how to run a Schedule on demand in a test (`<domain>ScheduleCreate(useCases).run()`).
  - `docs/agents/ui.md`: the loader and action contract, a refused change as a message on the page with the Domain's status table, showing controls with its "can" predicates, `useLiveUpdates` (with `id: null`), form controls (native `select` without JavaScript, `datetime-local` as UTC), page tests on memory connections, and removing a page.

  To upgrade a Project: `pnpm template-upgrade` adds both docs and their two "Read when" lines in `AGENTS.md`. The Template's `foo-schedule.test.ts` now runs the Schedule on memory ports instead of a mocked Use case; apply the same change to each Domain's `<domain>-schedule.test.ts` by hand if you want it.
- 0556054: Seeds return the rows they ensured, and a script example shows the pattern.
  - `fooSeed(u, actor)` creates each example by its name, reads the row that holds a name already taken, and returns all three foos. An empty, half-seeded or seeded database ends the same, so `pnpm seed` can run twice. A seed that needs another Domain's ids keeps the result: `const foos = await fooSeed(...)`, then pass it to the next seed.
  - `pnpm api-smoke [--url <origin>] [--wait <seconds>]` (`scripts/api-smoke.ts`) gets the dev client's token, calls `/api/v1/openapi.json` and every GET route without a path parameter, prints one line per call and a summary, exits 1 on a failure and flushes telemetry last. `docs/agents/scripts.md` explains how to copy it for a Project's own script.

  To take this: copy `src/domains/foo/api/foo-seed.ts` into your Domains' seeds by hand where a seed should return its rows, and take `scripts/api-smoke.ts`, its two tests, `docs/agents/scripts.md` and the `api-smoke` script line from the Template (`pnpm template-upgrade` brings them).

### Patch Changes

- c0d7cf7: `docs/agents/events.md` covers what an agent had to guess about Events: where per-key order stops (a Consumer that needs another key's row creates it on demand, a redriven dead Event runs late, a version guard for stale Events), Consumers that write a shared Aggregate (lock the root, in id order), fan-out in a Consumer (one lock order, chunks under the bind-parameter limit, several transactions before the 5 s limit), a column holding another Domain's id ships with its `deleted` Consumer (rule A14) and the repository side of that clean-up, testing a Consumer with `queueTestConsumerRun`, when one release is enough to change an Event's shape and what must be drained before you narrow, and naming for analytics and live channels beside Events.

  To upgrade a Project: take `docs/agents/events.md` from the Template.
- Updated dependencies [db36be7]
- Updated dependencies [64cd00e]
- Updated dependencies [78bef1a]
- Updated dependencies [a278133]
- Updated dependencies [a217e91]
  - @n8io/baseline-authn@6.0.0
  - @n8io/baseline-http@3.0.0
  - @n8io/baseline-postgres@5.2.0
  - @n8io/baseline-cache@6.2.0
  - @n8io/baseline-queue@8.1.0
  - @n8io/baseline-live@7.2.0
  - @n8io/baseline-telemetry@2.0.0

## 7.1.0

### Minor Changes

- 92e9814: Add `@n8io/baseline-redis`: `redisClientCreate({ url, vendor? })` opens the one Redis connection the cache and live updates share, with the startup and reconnect behaviour the Template used to hand-roll (fail at startup within 3 s, then reconnect for good; the `error` event always listened to). The Template's `src/redis.ts` becomes `src/redis-open.ts`, which only turns `CACHE_URL` into a client and its shutdown step, and the app no longer depends on `redis` directly.

  To upgrade: when `pnpm template-upgrade` conflicts on `src/redis.ts`, delete it and `src/redis.redis.test.ts`, and move any setting you changed there to `vendor` in `src/redis-open.ts`. Take `architecture-test-rules.ts` from the Template as it is.

### Patch Changes

- Updated dependencies [92e9814]
  - @n8io/baseline-redis@1.0.0

## 7.0.0

### Major Changes

- d96b15b: Events are kept in order per Event key, and Consumers fetch them in batches.
  - **Breaking:** `EventsPublisher.publish` takes one object with a required, non-empty `key`: `publish({ name, data, key })`. The key is the Event key, the id of the entity the Event is about. `queueEventsMemoryCreate` records the key too. In a Project, every `publish(name, data)` becomes `publish({ name, data, key })`, and the Domain's `<domain>Events` port and memory state gain `key`.
  - Each Consumer gets the Events of one Event key one at a time, in the order their transactions committed, on any number of workers; other keys run beside them. A worker fetches up to 10 Events at once and runs 4 at a time, and a backlog drains without waiting for a poll (measured: about 1,000 Events a second over 50 keys on 12 workers, about 150 a second on one busy key).
  - An Event that fails all five attempts now stays in its queue for 7 days and holds back its Event key, with a copy in `<queueName>.dead`. `queue.blockedKeys()` lists blocked keys, the worker logs each at error level, and the queue README has the runbook to run the Event again or give it up.
  - A worker that dies mid-Event or mid-Schedule is noticed within 30 to 90 s (it was 15 minutes), and a fetch still running after five minutes has its unfinished Events failed and retried.
  - Upgrading needs no step: Consumer queues move to `<queueName>.ordered`, the old queues are drained during the rollout and removed by a `queueMigrate` a week or more later. See "Upgrading to 8" in the queue README.
  - `events-and-bridges.md` gains the Event key, the ordering guarantee and the rule for changing an Event's shape across a rollout. "Event key" is a glossary term.
- c12b043: Workers stay up through a Postgres failover, and Schedules are safe in a rolling deploy.
  - **Liveness.** `queue.isAlive()` is false only when the worker's own poll loop hangs. A poll that fails counts as proof the loop runs, so a Postgres outage of any length no longer makes every Worker fail `/livez` and restart together; they carry on by themselves when Postgres is back. A process that cannot reach Postgres at boot still fails and never reports ready.
  - **Breaking:** `queueSchedulesRegister` is replaced by two functions. `queueSchedulesSync({ databaseUrl, schedules, env })` adds, updates and removes Schedules from the migrate entry, once per deploy with the newest code. `queueSchedulesStart({ queue, schedules, env })` runs them in the worker and changes nothing: a Worker of the previous version that boots mid-rollout can no longer remove a new Schedule or put an old cron back. A Schedule the database does not hold is not started and is logged as a warning.
  - `queueCreate` takes `concurrency`: how many Events and Schedule runs a worker has under way at once, across all its Consumers and Schedules (default 4). It was 4 per Consumer, which let a Worker with a few Consumers use up its own pool. An Event or run that the queue has given up, because it hangs, gives its place back.
  - Every worker looks for blocked Event keys once a minute, logs each new one at error level and reports `baseline.queue.blocked_keys` per Consumer, so a key blocked by an Event the queue failed by itself is seen too.
  - Queue errors that pg-boss reports as plain objects are logged as an `Error` with the message, stack and code, and the object as its `cause`, and each queue's failures are logged once per 30 s, so an outage does not log every failed poll. A worker whose queue `queueMigrate` has removed logs one warning and stops polling it, where it used to log an error on every poll.
  - Template: `src/migrate.ts` syncs the Schedules, `src/worker.ts` starts them, and each Domain's `api/<domain>-schedule.ts` exports its name and cron as `<domain>Schedule` beside `<domain>ScheduleCreate`. `src/connections.ts` runs one query at boot, so a Server or Worker that cannot reach Postgres never reports ready. The Worker no longer waits 5 s before it shuts down, since no load balancer sends it traffic, and it runs one Event or Schedule run fewer at once than its pool has connections.

  To upgrade a Project: in each `api/<domain>-schedule.ts` export `<domain>Schedule = { cron, name }` and spread it into `queueScheduleCreate`; export it from `api/index.ts`; in `src/migrate.ts` call `queueSchedulesSync({ databaseUrl, env: ENV, schedules: [...] })` after `queueMigrate`; in `src/worker.ts` rename `queueSchedulesRegister` to `queueSchedulesStart` and set `drainDelayMs: 0`; copy the query in `connectionsOpen` and the `concurrency` line in `src/queue-open.ts`. Run migrate before the new Workers start, as every deploy does, and give migrate the same `SCHEDULE_*` variables as the Worker: the cron overrides now act in migrate, and the Worker reads only `off`.

### Minor Changes

- 5b701d0: Production can boot without calling 1Password, and a Kubernetes deploy guide says how to run many pods.
  - `OP_SERVICE_ACCOUNT_TOKEN` is no longer required in production. A variable already set in the environment wins over its `op()` reference in `.env.production` and is never fetched, so a runner that sets every one of them (a Kubernetes Secret synced from the vault, for example) boots with no token and no call to 1Password. With a token nothing changes. With no token, a reference that is not set fails the boot and names the variable.
  - New `docs/agents/deploy-kubernetes.md`: roles, probes, pool sizing with a worked 12-pod example, PgBouncer, secrets, graceful shutdown, the load balancer idle timeout, rolling deploys, Redis outages, Event order and blocked Event keys, Redis high availability, alerts, known gaps and example manifests.

  To upgrade a Project: in `.env.schema` change the line above `OP_SERVICE_ACCOUNT_TOKEN=` from `# @required=forEnv(production)` to `# @required=false`, and copy `docs/agents/deploy-kubernetes.md` with its line in `AGENTS.md`.
- 11a204e: Postgres holds up with many processes on one database.
  - `postgresPoolCreate` takes `queryTimeoutMs` (default 15 s, `null` for no limit): a query that runs longer rejects and its connection is closed. The server may still finish it. Idle connections are probed after 10 s. A Project with a query that needs longer than 15 s outside `postgresMigrate` sets `queryTimeoutMs` in `src/connections.ts`.
  - `postgresMigrate` waits at most `lockWaitMs` (default 60 s) for its lock and then fails with an error that names the lock. It refuses to run through a connection pooler such as PgBouncer, where the lock would outlive the run and block the next one.
  - Template: `DATABASE_POOL_MAX` sets the most Postgres connections one process opens; without it the Server opens up to 10 and the Worker up to 5 (it was 10). `DATABASE_MIGRATE_URL` points migrate at Postgres itself where `DATABASE_URL` goes through a pooler.
- 32025d0: Survive pods of two UI versions during a rolling deploy.

  While old and new pods serve side by side, a page from one version can ask a pod of the other for its hashed files. Before, that pod rendered a whole 404 page (or a redirect to sign-in) with no cache header, and the browser was left with a page without styles or scripts.
  - `src/server.ts`: a request under `/assets/` for a file this build does not have answers a bare `404` with `cache-control: no-store`, so nothing in front keeps it and a retry can reach a pod that has the file.
  - `src/ui/asset-reload-listen.ts`, inlined first in `<head>` by `src/ui/root.tsx`: when one of the page's own stylesheets or scripts fails to load, the page reloads once (a page that was itself reloaded this way does not reload again). React Router already reloads when a route's script fails to load or the route manifest's version has changed.
  - `src/ui/csp-nonce.ts`: `CspNonce` gives a component the request's CSP nonce for an inline script of its own; `src/ui/entry.server.tsx` provides it.
  - `test/integration/rollout.test.ts` runs two versions side by side; `productionServerStart` takes a `directory`.

  To adopt it in a Project, copy those files and the `configure` option in `src/server.ts`. One reload narrows the window but cannot close it; to close it, serve `/assets/` from storage that keeps the previous build, or use session affinity.

### Patch Changes

- 31cc578: Outlast the load balancer's idle timeout, and stop tracing idle polls.
  - http: `httpServerKeepAlive(server)` keeps idle connections open for 65 s (Node's default is 5 s) and gives headers 66 s. A load balancer with the usual 60 s idle timeout no longer reuses a connection the pod has closed, which the client saw as an occasional 502. Keep the balancer's idle timeout under 65 s.
  - app: `src/server.ts` calls `httpServerKeepAlive(server)` first in `serverServe`. A Project adds that line and its import on upgrade.
  - health: the probe server keeps idle connections for 65 s too, and `close()` now drops every open connection, so a half-sent probe cannot hold shutdown.
  - telemetry: pg and Redis spans are made only inside a trace (`requireParentSpan`). A query in a request, a Consumer or Schedule run or a use case keeps its span; a queue poll, boot or maintenance query makes none. Redis still makes one `redis-connect` span per connection it opens. pg's metrics follow its spans: `db.client.operation.duration` counts only queries inside a trace, and a pool's `db.client.connection.*` metrics start with its first query inside a trace.
- 0029cba: Baseline no longer supports Apache Pulsar. `@n8io/baseline-pulsar` is removed from the repo and gets no further releases; Events run on the queue alone.
  - **Breaking:** queue no longer exports `queueJobRun` or `queueRetryLimit`, which only the pulsar package used.
  - app: `eventsOpen(queue)` in `src/events-open.ts` takes the queue alone, and only the composition roots, `src/authn.ts` and `src/connections.ts` read `#env` (rule A22). The docs drop their Pulsar notes. To upgrade, change `src/events-open.ts` and its call in `src/queue-open.ts` to match, and copy `architecture-test-rules.ts` with `architecture-test-samples/a22-ui-reads-env.txt` together (the A22 message changed). A Project still on Pulsar stays on its pulsar 4.x and this Template's previous release: pulsar 4 works with queue 7 only.
- 1b14e24: Keep serving through a Redis outage.
  - cache: `cacheCreate` fails open. A store error or timeout is a miss on `get` and resolves on `set` and `delete`; it is counted on `baseline.cache.store_errors` and logged once per 30 s. After a failed `set` or `delete` the same process reads that id as a miss until the entry has expired. `onStoreError: "throw"` keeps the old behaviour. The package now has `@opentelemetry/api` as a peer.
  - live: `liveHub.send` never rejects. A lost update is counted on `baseline.live.sends_failed` and logged once per 30 s. When the Redis subscriber reconnects, every open stream sends `ready` again within 1 to 5 s, so pages reread what they missed. The package now has `@opentelemetry/api` as a peer.
  - app: no code to change in a Project. Tests show a Use case still answers with the cache store or the hub down, and `docs/agents/pieces.md` states how stale a cached read can be (the entry's lifetime, 60 s by default).
- 0029cba: The unit test project gives hooks 20 s, like its tests. Importing `server.ts` in a `beforeAll` took over the default 10 s on a busy CI runner.
- Updated dependencies [d96b15b]
- Updated dependencies [31cc578]
- Updated dependencies [11a204e]
- Updated dependencies [0029cba]
- Updated dependencies [1b14e24]
- Updated dependencies [c12b043]
  - @n8io/baseline-queue@8.0.0
  - @n8io/baseline-health@2.0.1
  - @n8io/baseline-http@2.1.0
  - @n8io/baseline-telemetry@1.4.0
  - @n8io/baseline-postgres@5.1.0
  - @n8io/baseline-cache@6.1.0
  - @n8io/baseline-live@7.1.0

## 6.0.1

### Patch Changes

- 4e0d228: `AGENTS.md` now says a function's second positional input may be optional, as in `fooTransaction(work, inbox?)`; only three or more inputs need one input object.

## 6.0.0

### Major Changes

- bcdb0ce: A function with three or more inputs takes one typed input object, and Biome's `useMaxParams` (max 2) now fails on a third parameter in the packages and the Template. A callback whose shape a library fixes (pino's `logMethod`, the Pulsar client's log, `String.replace`, the `DrizzleQueryError` constructor in a logger test) carries a `biome-ignore` naming that library.

  Breaking changes in the packages, with the new call:
  - `@n8io/baseline-cache`: `CacheStore.set({ json, key, ttlMs })`. A Project's own `CacheStore` changes its `set` the same way. `Cache<T>.set(id, value)` is unchanged.
  - `@n8io/baseline-live/client`: `useLiveUpdates({ channel, id, pathPrefix? })`.
  - `@n8io/baseline-postgres`: `postgresTransactionRun({ pgPool, timeoutMs?, work })`, where a `null` or missing `timeoutMs` means 5 s.
  - `@n8io/baseline-queue`: `queueConsumerCreate({ eventName, queueName, run, schema })`, `queueScheduleCreate({ cron, name, run })`, `queueSchedulesRegister({ env, queue, schedules })` and `queueJobRun({ job, queueName, work })`.

  `@n8io/baseline-authn` and `@n8io/baseline-pulsar` change only inside.

  In the Template, `useLiveUpdates`, `queueScheduleCreate`, `queueSchedulesRegister` and the test helpers move to the object form. A Use case that a Consumer calls takes the `inbox` in its input, `u.invoiceCreate(actor, { amountCents, customerId, inbox })`, so a Use case keeps two parameters. To upgrade a Project: change each call above, including every Domain's `api/<domain>-schedule.ts` (`queueScheduleCreate`), `src/worker.ts` (`queueSchedulesRegister`), each `ui/routes/<domain>-detail.tsx` (`useLiveUpdates`), each `spi/<domain>-transaction.postgres.ts` (`postgresTransactionRun`) and each Consumer and the Use case it calls. Each Domain's tests copied from foo change too: `spi/<domain>-transaction.postgres.test.ts` (`queueConsumerCreate`), `test/integration/<domain>-worker-shutdown.test.ts` (`productionServerWaitFor`), and the local helpers in `api/<domain>-routes.test.ts`, `ui/routes/<domain>-detail.test.ts` and `use-cases/<domain>-stale-archive.test.ts`; then run `pnpm check`, which names any function left with three parameters.
- 3695b6e: The Template's wiring functions each take one input object: `connectionsOpen({ role })`, `redisOpen({ steps, url })`, `redisClientCreate({ url })`, `cacheStoreOpen({ redis })`, `liveHubOpen({ redis, steps })`, `queueOpen({ database, intakes, resources, role })`, `analyticsOpen({ steps, token })` and `errorTrackingOpen({ dsn, environment, steps })`. `src/connections.ts` now reads `ENV` from `#env` itself (rule A22 allows it, and `src/events-open.ts`, where the Pulsar guide reads `PULSAR_URL`), so a call site passes only the role. `queueOpen` returns `{ events, queue }` and calls `eventsOpen` only once the queue is real, so `eventsOpen` takes a `Queue` and returns `Events`; the Pulsar guide shows the new shape.

  To upgrade, change every `connectionsOpen(ENV, "publisher")` to `connectionsOpen({ role: "publisher" })` (and `"worker"` likewise), and drop the `ENV` import where nothing else uses it. Each Domain's copied tests call it: `spi/index.test.ts`, `spi/index-queue.test.ts`, `api/<domain>-live.test.ts`, `ui/routes/<domain>-list.test.ts` and `ui/routes/<domain>-detail.test.ts`. Change any call of the other functions above in the Project's own code to the object form. A Project with its own `src/events-open.ts` changes its `queue` type to `Queue` and its return type to `Events`.

  `env-files.test.ts` checks `.env.development` and `.env.test` with `varlock load` itself instead of a hand-written parser of `.env.schema` decorators, so it now also checks each value's type. It reads only the committed files, never a `.local` one. Undeclared items and plain values in `.env.production` are still refused. The Template's piece markers are down from 87 to 82, and a root test keeps them at 91 or fewer, 6 per file (7 in `src/connections.ts`).

  The Template's CI now calls `app-ci.yml@v6`.

### Patch Changes

- Updated dependencies [bcdb0ce]
- Updated dependencies [3695b6e]
  - @n8io/baseline-cache@6.0.0
  - @n8io/baseline-live@7.0.0
  - @n8io/baseline-postgres@5.0.0
  - @n8io/baseline-queue@7.0.0
  - @n8io/baseline-authn@5.0.1

## 5.0.0

### Major Changes

- d75cd90: `@n8io/baseline-authn/testing` is new: `authnTestSignIn({ url, who, secret })` signs in at a served app through the memory issuer's form and returns `authorization`, `cookie`, `token` and `accessCookie`. It opens the access cookie with the package's own cookie code. Import it from test files only. The README has a Testing section.

  `authnMemoryTokenCreate` takes one options object: `authnMemoryTokenCreate({ authn, actor })`. A call that passes `authn` and the Actor as two arguments no longer compiles.

  In the Template, `test/integration/integration-sign-in.ts` calls `authnTestSignIn` and holds no cryptography of its own; `integrationSignIn(url, who)` and `SignedIn` are unchanged, so tests that call it do not change. `src/server-wiring.test.ts` passes `{ actor, authn }`. When you upgrade, take the new `integration-sign-in.ts` whole, and change every `authnMemoryTokenCreate(authn, actor)` in your own tests to `authnMemoryTokenCreate({ actor, authn })`.
- 719041e: `queueEventsMemoryCreate` takes one options object: `queueEventsMemoryCreate({ published })`. `published` is optional and so is the whole argument, so `queueEventsMemoryCreate()` still works. A call that passes the array on its own no longer compiles.

  In the Template, `foo-transaction.memory.ts` passes `{ published: pending }`. When you upgrade, make the same change in every Domain's `spi/<domain>-transaction.memory.ts`: `queueEventsMemoryCreate<…>(pending)` becomes `queueEventsMemoryCreate<…>({ published: pending })`.
- 94f2893: Four Packages no longer need you to install Zod to use them. You bring the schema library, and each README shows how to pass a Zod schema.
  - `@n8io/baseline-cache` and `@n8io/baseline-queue`: `cacheCreate`'s `schema` and `queueConsumerCreate`'s schema are any [Standard Schema](https://standardschema.dev), so a Zod, Valibot or ArkType schema goes in as it is. Calls that pass a Zod schema do not change. The `zod` peer is gone. A Consumer's validation error now names the paths that failed in its message (`Event failed validation for billing.order-placed at totalCents`) and has no `cause`, so no validator's message can put an Event's values in a log.
  - `@n8io/baseline-id`: `idSchemaCreate` is gone. `idPatternCreate(prefix)` returns the `RegExp` to build an id schema from, in any schema library.
  - `@n8io/baseline-authn`: `Actor` is a type only; the Zod schema of the same name is no longer exported. Zod is the package's own dependency now, not a peer.

  `@n8io/baseline-http` keeps its `zod` peer: it is built on `@hono/zod-openapi`.

  In the Template, the new `src/id-schema.ts` exports `idSchemaCreate`, the Zod schema built from `idPatternCreate`. Foo: `models/foo.ts` imports `idSchemaCreate` from `../../../id-schema.ts`, not from `@n8io/baseline-id`, and `ui/routes/foo-detail.tsx` parses the id with `Foo.shape.id`. When you upgrade, change that import in every Domain's `models/<domain>.ts` and anywhere else that imports `idSchemaCreate`.

  This Release is `app@5.0.0`, so it creates the tag `v5`. The Template's `ci.yml` calls `app-ci.yml@v5` and `dependabot-automerge.yml@v5`; `v4` stays frozen at `app@4.0.0`.

### Minor Changes

- 0ab399e: `structure.test.ts` now budgets `AGENTS.md` in bytes instead of lines (14,000, about 3 KB above the Template's own file), since every task loads it. It also fails when an `@CONTEXT.md` import is not alone on its line (in a sentence, Claude Code takes the punctuation after it as part of the path and loads nothing) or names a missing file. The check lives in `agent-docs-test-rules.ts`. A Project whose `AGENTS.md` is over the budget moves task-specific rules to `docs/agents/` and links them under `## Read when`.

  `AGENTS.md` now says in words where the glossary is, for agents that do not follow `@` imports, and drops the Dependabot merge rule, which `docs/agents/dependency-updates.md` holds. `docs/agents/deploy.md` drops its Template upgrade line, which `template-upgrade.md` holds, and the walkthroughs no longer name a fixed `app-ci.yml` major.
- 3348934: Add `@n8io/baseline-error-tracking`: Error reports sent to Sentry (through `@sentry/core`) with their class name, stack, cause chain, error code and trace id, never their message. `@n8io/baseline-logger` gains `loggerErrorListen`, which hears every error logged at error or fatal, so the Template reports HTTP 500s, failed jobs and crashes without changing a caller. The Template reads an optional `SENTRY_DSN` (without it, errors are only logged) and removes it all with `pnpm piece-remove error-tracking`.
- b89fc1a: The Template has a new architecture rule, A24: only a `*.test.ts(x)` file or a file under `test/` imports `@n8io/baseline-<package>/testing`, the entry a Package exports its test helpers from. Production code imports the Package's main entry, where its memory adapter is. `AGENTS.md` says so under Tests.

### Patch Changes

- a61f217: Every handle that must be closed now has `[Symbol.asyncDispose]`, which calls its named close, so `await using` closes it however its block ends: `LiveHub` (`close`), `Queue` (`stop`), `HealthServer` (`close`), `Analytics` (`close`), `Pulsar` (`close`) and `PostgresPool` (`end`; the type is now pg's pool plus `AsyncDisposable`, and `postgresPoolCreate` adds the method to the pool it returns). The named methods stay.

  Breaking for code that builds one of these handles by hand, such as a test fake typed `LiveHub` or `Analytics`, or a raw `pg.Pool` passed where a `PostgresPool` is expected: add `[Symbol.asyncDispose]`, or build the pool with `postgresPoolCreate`.

  In the Template, `docs/agents/using.md` states the rule: use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process.
- 4f2d9eb: Integration tests close what they open with `await using`. The integration database, the app process the server and worker helpers start, the OTLP receiver and the slow request now dispose themselves (`drop`, `stop`, `close` and `abort` still work), so a test declares each one with `await using` (`using` for the slow request) and they close in reverse order: the process stops before its database is removed. Those tests now get 60 s, since teardown counts against the test timeout. The `cleanups` arrays and their `afterEach` hooks are gone.
- 797590d: `@n8io/baseline-live/testing` is new: `liveTestSseRead({ response })` reads a live stream in a test. `until(text)` waits for text to arrive, `end()` waits for the server to end the stream and `cancel()` goes away like a page that closes. Import it from test files only. The README has a Testing section with the memory hub and the reader together.

  In the Template, the Foo tests read their live streams with this reader, so no test reads a response body by hand. When you upgrade, a Domain test that copied the hand-written reader can use `liveTestSseRead` in its place.
- 9cd00df: The template scripts remove their temp folders with `using` and `fs.mkdtempDisposableSync` instead of `try`/`finally`. No behaviour change.
- Updated dependencies [d75cd90]
- Updated dependencies [3348934]
- Updated dependencies [a61f217]
- Updated dependencies [797590d]
- Updated dependencies [719041e]
- Updated dependencies [94f2893]
  - @n8io/baseline-authn@5.0.0
  - @n8io/baseline-error-tracking@1.0.0
  - @n8io/baseline-logger@3.1.0
  - @n8io/baseline-analytics@2.0.0
  - @n8io/baseline-health@2.0.0
  - @n8io/baseline-live@6.0.0
  - @n8io/baseline-postgres@4.0.0
  - @n8io/baseline-queue@6.0.0
  - @n8io/baseline-cache@5.1.0
  - @n8io/baseline-id@3.0.0

## 4.0.0

### Major Changes

- 22c4a54: The cache's backend is picked once per process, not once per Domain. `@n8io/baseline-cache` now exports `CacheStore`, `cacheCreate(store, { prefix, schema, ttlMs? })`, `cacheStoreRedisCreate({ redisClient })` and `cacheStoreMemoryCreate()`. `cacheRedisCreate`, `cacheMemoryCreate`, `cacheRedisClientCreate` and the `RedisClient` type are gone, and the package no longer has a `redis` peer: the Redis store takes any connected node-redis client.

  In the Template, the new `src/cache-store-open.ts` is the only file that picks the backend, and `connectionsOpen` returns its store as `connections.cacheStore`. With `memory://` every cache shares one store, as on Redis, so two caches need different prefixes. Architecture rule A12 refuses `cacheStoreRedisCreate(` in a Domain. Each Domain has one `spi/<domain>-cache.ts` (`<domain>CacheCreate(cacheStore)`) with one `spi/<domain>-cache.test.ts`.

  When you upgrade, in each Domain: replace `spi/<domain>-cache.redis.ts` and `spi/<domain>-cache.memory.ts` with a `spi/<domain>-cache.ts` copied from Foo, replace their two tests and `spi/<domain>-cache.contract.ts` with Foo's `spi/foo-cache.test.ts`, pass `connections.cacheStore` in `spi/index.ts`, and pass `cacheStoreMemoryCreate()` in `spi/<domain>-ports.memory.ts`. If you used `cacheRedisClientCreate`, use `redisClientCreate` from the Template's `src/redis.ts`; outside the Template, call node-redis's `createClient` yourself with an `error` listener, a connect timeout and a reconnect strategy.
- ef20aa0: Events go through one `Events` handle, whatever carries them, so moving Events from the queue to Pulsar changes one file in a Project instead of every Domain.

  `@n8io/baseline-queue` exports `Events` (`consumersSubscribe`, `consumersStart`, `publisherCreate(transaction)`, `isAlive`), `EventsPublisher` (`publish`, then `committed()` once the transaction has committed) and `queueEventsCreate(queue)`. `queueEventsPgBossCreate`, `QueueEvents`, `queueConsumersSubscribe` and `queueConsumersStart` are gone. `queueCreate`, `publisherCreate` and `queueInboxInsert` take a `QueueSql` (anything with `query(text, values?)`), so the package no longer has `pg` or `@types/pg` peers.

  `@n8io/baseline-pulsar` exports `pulsarCreate` (its `token` may now be `undefined`) and `pulsarEventsCreate(pulsar)`, which now returns that same `Events`. `PulsarEvents`, `pulsarConsumersSubscribe` and `pulsarConsumersStart` are gone; `send()` is `committed()`.

  In the Template, the new `src/events-open.ts` is the only file that names the transport, and `connectionsOpen` returns it as `connections.events`.

  When you upgrade:
  - In each Domain's `spi/<domain>-transaction.postgres.ts`, take `events: Events` in place of `queue: Queue`, create the publisher with `events.publisherCreate<<Domain>EventMap>(pgClient)`, and call `committed()` on it after `postgresTransactionRun` returns ok. Copy the shape from Foo.
  - In each Domain's `spi/index.ts`, read `connections.events` in place of `connections.queue`.
  - In `src/server.ts`, call `connections.events.consumersSubscribe([...])`. In `src/worker.ts`, call `events.consumersStart([...])` and report `queue.isAlive() && events.isAlive()`.
  - In tests that build a Postgres transaction, pass `queueEventsCreate(queue)`.
  - A Project already on Pulsar moves its client into `src/events-open.ts` as the pulsar README shows, and drops its other Pulsar wiring.
- 1137ee3: Three more Package surfaces stop naming a vendor.

  `@n8io/baseline-live`: `liveStreamCreate({ liveHub, channel, id, expiresAt, signal })` no longer takes a Hono context. It answers a web `Response` for any server, and the `hono` peer is gone. Pass the request's `signal` (`c.req.raw.signal` in Hono) so the stream ends when the request is aborted. A page that stops reading is dropped once 64 KiB wait for it. The response no longer sends `Connection: keep-alive`, which HTTP/2 forbids.

  `@n8io/baseline-postgres`: `postgresPoolCreate` takes `{ databaseUrl, max?, connectTimeoutMs? }`, not pg's `PoolConfig`. The Package exports `PostgresPool` and `PostgresClient`; name those in your own signatures. They are still pg's pool and client, because Drizzle needs the real ones. Other `PoolConfig` overrides (`ssl`, `idleTimeoutMillis` and the rest) are no longer accepted; put them in the database URL where pg reads them, or ask for an option.

  `@n8io/baseline-telemetry`: the new `@n8io/baseline-telemetry/span` entry exports `telemetrySpanAttributesSet(attributes)` and `telemetrySpanRun(name, work)`.

  In the Template, no file in `src/` imports `@opentelemetry/api` or `pg`: Use cases set span attributes with `telemetrySpanAttributesSet`, and architecture rules A8 and A21 enforce it. Architecture rule A16 now reads `telemetrySpanAttributesSet` and also allows a `baseline.<domain>.<thing>_count` key. When you upgrade: remove the first argument of each `liveStreamCreate` call, pass `signal` and answer with `c.newResponse(live.body, live)` as Foo's `api/foo-live.ts` does (a bare `Response` loses headers that middleware set with `c.header()`), replace `trace.getActiveSpan()?.setAttributes(...)` with `telemetrySpanAttributesSet(...)` and a hand-written child span with `telemetrySpanRun`, replace `pg.Pool` with `PostgresPool`, and rename a `connectionTimeoutMillis` override to `connectTimeoutMs`.
- 867f91e: Vendor-only settings have one way in. `postgresPoolCreate`, `postgresMigrate`, `queueCreate`, `queueMigrate`, `pulsarCreate` and `analyticsMixpanelCreate` take a `vendor` option, typed as the vendor's own settings and passed through: `ssl` for Postgres, pg-boss's tuning, OAuth2 or mTLS for Pulsar, Mixpanel's `host` for data residency. A Package's named options win, and `vendor` throws on the keys they set and on the ones that would do nothing. `vendor` is outside each Package's contract: it is not tested, and a vendor swap deletes it.

  In the Template, `docs/agents/vendor-settings.md` says when to use it, and architecture rule A12 allows the vendor factories only in `src/connections.ts`, `src/redis.ts` and the `src/*-open.ts` files.

  A factory that is one vendor's takes one options object: `analyticsMixpanelCreate({ token, vendor? })`, `cacheStoreRedisCreate({ redisClient })` and `liveHubRedisCreate({ redisClient })` replace their positional forms. When you upgrade, wrap the argument of those three calls.

### Minor Changes

- fedd96f: Add `@n8io/baseline-analytics`: analytics events sent to Mixpanel after commit, without blocking the request. The Template tracks `foo.created`, reads an optional `MIXPANEL_TOKEN` (without it, events go to the debug log and are not sent), and removes it all with `pnpm piece-remove analytics`.

### Patch Changes

- bbf55c4: The Template's `ci.yml` calls `app-ci.yml@v4` and `dependabot-automerge.yml@v4`, the tag this Release creates. `v3` stays frozen at `app@3.0.0`.
- Updated dependencies [fedd96f]
- Updated dependencies [22c4a54]
- Updated dependencies [ef20aa0]
- Updated dependencies [d63058e]
- Updated dependencies [1137ee3]
- Updated dependencies [867f91e]
  - @n8io/baseline-analytics@1.0.0
  - @n8io/baseline-cache@5.0.0
  - @n8io/baseline-queue@5.0.0
  - @n8io/baseline-authn@4.0.0
  - @n8io/baseline-logger@3.0.0
  - @n8io/baseline-live@5.0.0
  - @n8io/baseline-postgres@3.0.0
  - @n8io/baseline-telemetry@1.3.0
  - @n8io/baseline-http@2.0.1
  - @n8io/baseline-shutdown@3.0.1

## 3.0.0

### Major Changes

- 8903db0: The Template takes `@n8io/baseline-authn`'s React Router exports from its new `/react-router` subpath, and passes `memoryIssuerAllowed: envLocal` to `authnCreate`. When you upgrade, import `actorContext` and `authnExpiryContext` from `@n8io/baseline-authn/react-router`, replace `authnActorRequire(args)` in loaders and actions with `authnPageActorRequire(args)` from the same subpath, and add `memoryIssuerAllowed: envLocal` to your `authnCreate` call.
- 1cc11af: The Template follows the full naming rule, and architecture rule A23 now checks all of it: an exported function in a Domain starts with the Domain's name, a factory ends in `Create`, and a predicate ends in `Is`, `Has` or `Can`. `ci.yml` calls `app-ci.yml@v3` and `dependabot-automerge.yml@v3`.

  When you upgrade, rename in each of your Domains what `pnpm domain-create` generated from `foo`:
  - `<domain>Routes`, `<domain>LiveRoutes`, `<domain>Schedule` → add `Create`.
  - `<domain>RepositoryPostgres`, `<domain>RepositoryMemory`, `<domain>CacheRedis`, `<domain>CacheMemory`, `<domain>TransactionPostgres`, `<domain>TransactionMemory`, `<domain>PortsMemory` → add `Create`.
  - Rules: `<domain>Deletable` → `<domain>DeleteCan` in `rules/<domain>-delete-can.ts`, `<domain>Updatable` → `<domain>UpdateCan` in `rules/<domain>-update-can.ts`, `<domain>Stale` → `<domain>StaleIs` in `rules/<domain>-stale-is.ts`.
  - `use-cases/<domain>-use-cases-create.ts` → `use-cases/<domain>-use-cases.ts`.
  - `authnProviderOptions` in `src/authn.ts` → `authnProviderOptionsCreate`.

  Then rename the package imports listed in the package changelogs, and run `pnpm check`: A23 names anything you missed.
- e5b29e0: The Template carries half as many piece blocks (85 by `git grep -c piece-start`, down from 193, and none above 5 in a file). The composition roots open every connection through `connectionsOpen(ENV, role)` in the new `src/connections.ts`, which calls one file per piece (`src/redis.ts`, `src/live-hub-open.ts`, `src/queue-open.ts`) and returns the shutdown steps too. Each Domain tests its cache, live updates and Events in files of their own (`use-cases/<domain>-use-cases-<piece>.test.ts`, `spi/index-queue.test.ts`), so the shared tests carry no blocks. Behaviour is unchanged.

  Upgrading changes every Domain. In each one:
  - `spi/index.ts`: `<domain>PortsCreate(connections: Connections)` takes the object `connectionsOpen` returns. The cache reads `connections.redis` instead of an option named `cache`; `database`, `queue` and `liveHub` keep their names.
  - `ports.ts`: the cache, live updates and Events port types sit inline in `<Domain>Ports` and `<Domain>TransactionPorts`; the separate `<Domain>Cache`, `<Domain>LiveUpdates` and `<Domain>Events` types are gone. Name them as `<Domain>Ports["<domain>Cache"]` where you need them.
  - `index.ts` re-exports its errors, models and port types with `export *`.
  - `spi/<domain>-ports.memory.ts` returns `{ ports, state }`; committed Events are in `state.published`, and the memory live updates port sends nothing.
  - The get, update and delete Use cases take the whole `<Domain>Ports`.

  In `src/server.ts`, `src/worker.ts` and `src/seed.ts`, replace the Redis, queue and live hub setup, the `ports` object and their shutdown entries with `const connections = await connectionsOpen(ENV, "publisher")` (`"worker"` in the Worker), pass `connections` to each `<domain>PortsCreate`, and spread `connections.intakes` and `connections.resources` into the shutdown lists. `pnpm domain-create` and `pnpm piece-remove` handle the new files.
- 17d5d09: `postgresPortsGuard`, `postgresCursorEncode`, `postgresCursorDecode` and `PostgresCursor` move out of `@n8io/baseline-postgres` into the Template, because the memory adapters use them too and none of them touches Postgres. They are now `transactionPortsGuard` in `src/transaction-ports-guard.ts` and `cursorEncode`, `cursorDecode` and `Cursor` in `src/cursor.ts`. When you upgrade, copy both files from the Template. In each Domain's `spi/*-transaction.memory.ts` and `spi/*-transaction.postgres.ts`, import `transactionPortsGuard` from `../../../transaction-ports-guard.ts`; in `spi/*-repository.memory.ts` and `spi/*-repository.postgres.ts`, import `cursorEncode` and `cursorDecode` from `../../../cursor.ts`.

### Minor Changes

- 6764931: `httpCsrf` wraps Hono's `csrf()` for cookie-authenticated routes: a form, multipart or text POST answers a 403 `Forbidden` problem unless `Sec-Fetch-Site` is `same-origin` or `Origin` is the server's public origin (https when `x-forwarded-proto` says so). The app runs it on every route except `/api/*`, which uses bearer tokens, so a cross-site post to a page action or to `/auth/sign-out` no longer relies on `SameSite=Lax` alone. A TLS-terminating proxy must set `x-forwarded-proto: https`.
- 226d3b7: `pnpm dev` starts Postgres and Redis itself (`docker compose up -d --wait`), and the Worker restarts when a file it imports changes (`node --watch`), so an edited Consumer or Schedule takes effect without a manual restart.
- 5f822bc: `pnpm piece-remove <piece>` removes a piece of the stack (`ui`, `live`, `cache`, `redis` or `queue`) in one command: its files and blocks, its packages and the imports nothing uses any more. It refuses a tree with uncommitted changes and an order that cannot work, such as `redis` before the cache and live updates, and prints the next steps. `docs/agents/pieces.md` now names the one command per piece instead of shell blocks; adding a piece back is still `git revert` of its "Remove <piece>" commit.
- ff5f930: A Project can now remove the cache, and then Redis, with the steps in `docs/agents/pieces.md`. The cache and live updates are separate pieces: removing the cache keeps live updates on Redis, and Redis goes only once both are gone. The composition roots open Redis with the new `src/redis.ts` (`redisClientCreate`) instead of `cacheRedisClientCreate`, so live updates no longer need `@n8io/baseline-cache`; their shutdown step is now named `redis`. Integration tests no longer pass `cacheUrl` to `productionServerStart` or `workerStart`: `production-server.ts` reads it from the global setup itself.
- 2227ab4: A Project can now remove the queue and the Worker with the steps in `docs/agents/pieces.md`: each Domain's Events and Schedules, `src/worker.ts`, its compose service, its image entry and the `SCHEDULE_*` overrides go together, and each Domain's transaction becomes a plain Postgres transaction. `pnpm domain-create` leaves them out of new Domains once `@n8io/baseline-queue` is gone. Removing the UI pages now edits the `dev` script in place instead of replacing it, so the two removals work in either order.
- 36477f3: A Project can now remove the UI pages or live updates. `docs/agents/pieces.md` lists the exact steps for each, and CI runs them on a fresh render to prove an API-only Project still passes check, unit tests and build and serves its API. The code each piece owns sits in `// piece-start: <piece>` to `// piece-end: <piece>` blocks, `pnpm domain-create` leaves a removed piece out of new Domains, and `src/server.ts` now exports its Hono `app`. The cache and the queue are not removable yet (#217, #218).

### Patch Changes

- ecc4ac7: An `/api/v1` request without a signed-in Actor now answers 401 before any route validates its input, so an anonymous caller no longer learns the API's input shape from 400 errors. `/api/v1/openapi.json` stays public.
- 5985c99: Docs match the code: the telemetry README shows the one preload file the Template uses (no `--experimental-loader`), the result README shows errors as `Error` subclasses with a `type` field, the queue Consumer example passes a machine Actor, the glossary adds Inbox and Repository, and `grafana/otel-lgtm` is pinned to a version tag.
- da55733: `glossary-check` takes the glossary and the tree to scan (`pnpm glossary-check [glossary] [tree]`, defaults `CONTEXT.md` and `.`), and no longer flags an alias inside a path or script name such as `test/integration` or `test:integration`.
- 1e03649: Integration tests no longer fail now and then because a production server exits at startup. Each Vitest worker now takes the ports for the servers it starts from its own block below the kernel's ephemeral range. Before, it asked the kernel for a free port and released it, and another process could take that port before the server bound it. A server that exits before it is ready now fails the test with its exit code, signal, stdout and stderr, and the server under test logs at `fatal`, so its crash log is in that report.
- 11e525b: Move `autoInstallPeers: false` from `.npmrc`, which pnpm 12 ignores for non-auth settings, to `pnpm-workspace.yaml`, and delete `.npmrc`. Projects that upgrade lose `.npmrc` and the Dockerfile stops copying it; keep only auth and registry lines in any `.npmrc` you add.
- 2c71490: A Domain's Postgres repository test drops its per-test databases in parallel, so the drops share one Postgres checkpoint instead of waiting on one each, and the integration project's `hookTimeout` is 30 s as a guard. A slow checkpoint no longer times out the file's `afterAll`. To pick it up in an existing Domain, copy the `closes` and `drops` lines from the Template's repository test into yours.
- 80f3783: The preload registers the OpenTelemetry ESM loader hook in-thread with `register()` from `import-in-the-middle/register-hooks.mjs` (`module.registerHooks`), so Node 26 no longer prints `[DEP0205] module.register() is deprecated` at startup. To match in your Project, replace `@opentelemetry/instrumentation` with `import-in-the-middle` (`^3.6.0`) in package.json and change `src/preload.ts` to:

  ```ts
  import { register } from "import-in-the-middle/register-hooks.mjs";
    register();
  await import("@n8io/baseline-telemetry/register");
  ```

  `@n8io/baseline-telemetry` no longer lists `@opentelemetry/instrumentation` as a direct dependency; its instrumentations still bring it.
- 0490322: `src/server-wiring.test.ts` proves the security guards with any pieces removed: the CSP and secure headers on every kind of response, `httpCsrf` on every `/auth` post, the `__Host-` session cookie, and 401 on every anonymous `/api/v1` operation before its route reads the body.
- bbdef54: The server reports ready on `/readyz` only once it is listening on `PORT`. Before, it marked itself ready as soon as it asked to listen, so a server about to crash on `EADDRINUSE` could answer `/readyz` 200 for a moment. A listen error now always ends in a logged crash and exit code 1 without a ready report, and the `Server listening and ready` log line marks the moment. The API-only server from `docs/agents/pieces.md` gets the same order, since it reports ready from the same listener.
- 40f92f9: A new Project now starts with the Template's own `pnpm-lock.yaml`, so its first install takes the versions the release was tested with instead of resolving every range fresh. A fresh resolution could fail on the day a dependency shipped: `minimumReleaseAge` let a package through whose platform binaries were published minutes later and were still too new. `pnpm template-upgrade` leaves a Project's lockfile alone; the next install updates only the ranges the release changed.
- b0fb22e: `docs/agents/template-upgrade.md` and `docs/agents/dependency-updates.md` walk a person through a Template upgrade and through dependency updates one step at a time. Ask your agent: "Walk me through a template upgrade with docs/agents/template-upgrade.md."
- Updated dependencies [8903db0]
- Updated dependencies [6764931]
- Updated dependencies [5985c99]
- Updated dependencies [dc8c9de]
- Updated dependencies [f86d684]
- Updated dependencies [1cc11af]
- Updated dependencies [80f3783]
- Updated dependencies [17d5d09]
  - @n8io/baseline-authn@3.0.0
  - @n8io/baseline-http@2.0.0
  - @n8io/baseline-telemetry@1.2.1
  - @n8io/baseline-result@1.1.1
  - @n8io/baseline-queue@4.0.0
  - @n8io/baseline-live@4.0.0
  - @n8io/baseline-cache@4.0.0
  - @n8io/baseline-id@2.0.0
  - @n8io/baseline-postgres@2.0.0
  - @n8io/baseline-shutdown@3.0.0

## 2.0.0

### Major Changes

- ecc00e0: The template's CI calls `app-ci.yml@v2`, which needs no token: the `PACKAGES_TOKEN` secret, the GitHub Packages registry setup and every `NODE_AUTH_TOKEN` are gone, and the caller drops `packages: read` and `secrets: inherit`. Every action is pinned to a commit SHA, and Dependabot keeps those pins current. Projects move to `app-ci.yml@v2` and `dependabot-automerge.yml@v2`; `v1` stays frozen where it is.

### Minor Changes

- ca7afb0: `httpSecureHeaders` applies Hono's secure headers (HSTS, nosniff, Referrer-Policy and the rest) with an enforced Content-Security-Policy: `default-src 'self'`, `script-src 'self'` plus a per-request nonce, `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'`. The app uses it on every response and hands the nonce to React Router's server render, so every inline script carries it, in development too. Request bodies on `/api/*` are capped at 1 MB and a bigger one answers 413 `PayloadTooLarge`. The memory issuer's sign-in pages drop their inline styles, which the CSP blocks. Rate limiting stays at the load balancer or edge.
- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- db838cc: Template docs: `AGENTS.md` keeps only the rules every task needs and ends with a `## Read when` index. Events, Bridges and Aggregates, Data rules, Tracing and spans, and Runtime notes move to `docs/agents/`, read only when the task needs them. `structure.test.ts` keeps `AGENTS.md` under 200 lines and checks that every linked doc exists and every doc is linked.
- 5467b94: Factories that build and return a thing now end in `Create`: `cacheMemory` is `cacheMemoryCreate`, `cacheRedis` is `cacheRedisCreate`, `queueEventsMemory` is `queueEventsMemoryCreate`, `queueEventsPgBoss` is `queueEventsPgBossCreate` and `pulsarEvents` is `pulsarEventsCreate`. There are no deprecated aliases; rename the imports.
- 2685036: The live hub factories follow the entity-first, verb-last naming: `liveMemory` is now `liveHubMemoryCreate` and `liveRedis` is now `liveHubRedisCreate`. There are no deprecated aliases; rename the imports in your composition roots and tests.
- a37704e: `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so pnpm refuses any release younger than a day. `@n8io/baseline-*` packages are exempt.

  If `pnpm install` then reports a duplicate `minimumReleaseAgeExclude` key, delete the older list of exact versions that pnpm wrote on its own.
- 4d37e1c: Template naming: AGENTS.md spells out the generic-to-specific rule (scope, subject, then action; factories end in `Create`, predicates in `Is`), and architecture rule A23 fails an exported name that starts with a verb. The integration helpers become `integrationSignIn` (in `integration-sign-in.ts`), `productionServerWaitFor` and `productionServerConnectResult`, and `loadContextCreate` becomes `uiLoadContextCreate`.
- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- b73602b: Telemetry now builds the metric reader itself, like the span and log processors: `OTEL_METRICS_EXPORTER` (`otlp` by default, `console` or `none`) and `OTEL_METRIC_EXPORT_INTERVAL` choose a periodic reader. Every signal exports OTLP over http/protobuf only; the grpc and http/json exporters are gone, and an `OTEL_EXPORTER_OTLP_*PROTOCOL` set to anything else prints one warning at start. The app's integration tests read OTLP protobuf and prove the use case duration metric reaches a collector.
- 2623e1e: The Node preloads live in one file, `src/preload.ts`: it loads varlock, registers the OpenTelemetry ESM loader hook and starts telemetry, in that order. Scripts run `node --import ./src/preload.ts <entry>`, and the image sets `NODE_OPTIONS="--import /app/src/preload.ts"` once, so its CMD and the compose worker are plain `node <entry>`. A runner that passes its own command should drop the flags and run `node src/worker.ts` or `node src/migrate.ts`. `dockerfile.test.ts` checks the one `NODE_OPTIONS` line and fails if the telemetry or loader-hook preload is named anywhere but `src/preload.ts`.
- bbb9fd5: `app-ci.yml@v2` adds a required `sast` job: Semgrep CE (pinned image, metrics off) with the `p/typescript`, `p/nodejs`, `p/react` and `p/secrets` rulesets, failing on any finding. app-create requires `ci / sast`. A suppression is `// nosemgrep: <rule-id> -- <reason>`, and `.semgrepignore` lists generated paths only.
- 3334669: Template docs: the Event entry says pg-boss carries Events by default and `@n8io/baseline-pulsar` is the one sanctioned swap, and Data rules say Drizzle stays on the pinned 1.0 rc until 1.0 GA.
- Updated dependencies [5467b94]
- Updated dependencies [ca7afb0]
- Updated dependencies [2685036]
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [b73602b]
- Updated dependencies [793ad13]
- Updated dependencies [acaff2a]
- Updated dependencies [33c61e9]
  - @n8io/baseline-cache@3.0.0
  - @n8io/baseline-queue@3.0.0
  - @n8io/baseline-http@1.2.0
  - @n8io/baseline-authn@2.1.0
  - @n8io/baseline-live@3.0.0
  - @n8io/baseline-health@1.1.0
  - @n8io/baseline-id@1.1.0
  - @n8io/baseline-logger@2.1.0
  - @n8io/baseline-postgres@1.2.0
  - @n8io/baseline-result@1.1.0
  - @n8io/baseline-shutdown@2.1.0
  - @n8io/baseline-telemetry@1.2.0

## 1.2.1

### Patch Changes

- f4f5c71: `pnpm build` always makes a production build. With `NODE_ENV=development` in the shell, `react-router build` made a development build that compiled out the server shutdown (`import.meta.env.PROD` was false), so SIGTERM killed the server at once.

## 1.2.0

### Minor Changes

- 0476761: Projects keep their dependencies up to date by themselves: Dependabot waits 7 days before offering a release (baseline packages excepted), groups patch and minor updates, and a new `automerge` CI job merges every update PR that is not a major once CI passes.

### Patch Changes

- f6ad1f1: Add `postgresPortsGuard` and `postgresCursorEncode`/`postgresCursorDecode` (generic over the id prefix). The Foo SPI imports them instead of keeping its own `foo-ports-guard.ts` and `foo-cursor.ts`, so a new Domain no longer copies them.
- f9e3433: New package `@n8io/baseline-pulsar`: Events and Consumers on Apache Pulsar 5, sent after the transaction commits, with the queue package's inbox for duplicates. Schedules stay on pg-boss. The queue package now exports `queueJobRun` and `queueRetryLimit`, which the pulsar package shares. The glossary's Event is now delivered once the change that caused it commits.
- cbd9f72: `queueStop` is gone: call `queue.stop()`. `schedulesRegister` takes the composition root's `ENV` (any object; an item that is not a string is no override), so the Worker no longer reads `process.env`. The shutdown package no longer exports the `ShutdownOptions` type; server.ts and worker.ts use `ShutdownHandle`. The postgres and queue tests share one Postgres test setup in `test/postgres/`.
- 80a93f3: Add a Spans section to AGENTS.md: when to set an attribute on the active span, when a Use case may start a child span, and when never to.
- 013aa86: Fix the "Where new work goes" table and the `pnpm dev` description in AGENTS.md, import `cn` through `#ui/lib/utils.ts`, split the integration test helpers, and tidy app-ci.yml: drop the redundant integration `env:` block and the image job's Dockerfile test step, and give every job a timeout.
- 9344425: The render and domain-create now work from `// domain-create: domains-start` / `domains-end` marker pairs in `server.ts`, `worker.ts`, `seed.ts`, `ui/context.ts` and `ui/routes.ts` instead of copies of those files' text, so editing those files outside the pairs no longer breaks the render. `.template.json` no longer gets a `repository` field.
- b99f091: Trim exports nobody imports and the dependencies nobody uses.
  - logger: the root no longer exports `LoggerErr`, `loggerErrSerialize`, `loggerRedactPaths` or `LoggerFields`. Import `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
  - authn: the root no longer exports `AuthnInvalidError`.
  - live: the root no longer exports the `LiveUpdate` type. `liveRedis` now takes the `RedisClient` type and time limit from `@n8io/baseline-cache`.
  - cache: `cacheRedisClientCreate` takes only `{ cacheUrl }`, and the root exports `cacheTimeLimit`.
  - postgres: drops its unused `zod` peer dependency.
  - app: drops the unused `lucide-react` dependency.
- Updated dependencies [f6ad1f1]
- Updated dependencies [f9e3433]
- Updated dependencies [cbd9f72]
- Updated dependencies [b99f091]
  - @n8io/baseline-postgres@1.1.0
  - @n8io/baseline-queue@2.0.0
  - @n8io/baseline-shutdown@2.0.0
  - @n8io/baseline-authn@2.0.0
  - @n8io/baseline-cache@2.0.0
  - @n8io/baseline-live@2.0.0
  - @n8io/baseline-logger@2.0.0
  - @n8io/baseline-http@1.1.1
  - @n8io/baseline-telemetry@1.1.1

## 1.1.0

### Minor Changes

- 75e4ae8: Projects install the baseline packages with the built-in GITHUB_TOKEN instead of a personal access token: the template CI grants `packages: read` and Dependabot needs no registry block.

## 1.0.3

### Patch Changes

- 859aff4: A cold `pnpm dev` no longer reloads mid-load with a failed `entry.client.tsx` import: `vite.config.ts` pre-bundles `class-variance-authority`, `cn` and `radix-ui`. The template now has a `public/` folder for static files, so the dev server no longer logs that `./public` is missing.

## 1.0.2

### Patch Changes

- 20dbeb1: Mutation testing is gone: no `pnpm test:mutation`, Stryker or `stryker.config.json`, and `app-ci.yml` has no `mutation` job (drop `ci / mutation` from your ruleset's required checks). `domain-create` now also copies foo's page tests (`test/unit/foo-{list,detail}.test.ts`, renamed) and, with a project's first domain, the home redirect test as `test/unit/home.test.ts`.

## 1.0.1

### Patch Changes

- 83f9868: Projects run CI through `app-ci.yml@v1`: the app ships `.github/workflows/ci.yml`, `.github/dependabot.yml`, a `test:mutation` script (Stryker on changed files) and a `ci` script.

## 1.0.0

### Major Changes

- 418010e: First release of the app template.
