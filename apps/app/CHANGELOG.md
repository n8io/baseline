# app

## 17.0.2

### Patch Changes

- e8a042f: The `changes` job in `app-ci.yml` checks out every blob instead of a partial clone. On a large pull request diff, `git diff` needed a blob it did not have, tried to fetch it with no credentials, and failed with "could not read Username".

## 17.0.1

### Patch Changes

- d610f31: Docs only: the Template's CONTEXT.md cites ADR 0012, `using.md` lists the feature-flags handles, and `pieces.md` no longer contradicts itself on removal order. No behaviour changes.

## 17.0.0

### Major Changes

- da3de3f: Move rules from prose and the architecture test into Biome. Breaking for a Project: its `pnpm check` can now fail on code that passed before.
  - `noRestrictedImports` overrides now check A1, A3 to A6, A7, A8 and A22 (the import boundaries between layers and contexts, `@hono/*` and OpenTelemetry, `varlock/env` and `#env`). A6 no longer checks that an ACL imports only the upstream named in its file name (A11 still checks the ACL's calls), and a seed may import values from another context's `index.ts`. `architecture-test-rules.ts` keeps what Biome cannot see: a value import of an `application/` file in `adapters/inbound/`, a value import of `src/contexts.ts` or `src/connections.ts` in a context, and a domain function reached from an adapter.
  - Grit plugins check A16 (span attribute keys; the check that the key names the Use case's own context or Model is gone), A34 (a cast on a flag value), `test()` instead of `it()`, a span started outside `@n8io/baseline-telemetry`, `Math.random()` and `crypto.randomUUID()` in a Use case, and an error's `.message` on a span or in a log.
  - `noRestrictedGlobals` bans `fetch`, `setTimeout` and `setInterval` in a Use case (A26).
  - `noConsole` (not in `scripts/`, `test/` and `src/blocked-keys.ts`), `noParameterAssign`, `useNamingConvention` and `useFilenamingConvention` are on.
  - The mock, spy and fake-timer ban also covers the test files of `packages/`.
- b72ecfb: Faster path from a new Project to production. `pnpm app-create --without a,b` removes Pieces at create time. The Template adds an optional `image-publish.yml` (pushes the image to ghcr.io on a `v*` tag) and `deploy/kubernetes.yaml`. Breaking for the shared CI: on a pull request, the eleven `piece (...)` jobs now run only when the diff touches a manifest, the piece tooling or a piece marker (and still on every nightly, dispatch and non-pull-request run), so the `pieces` check can pass without them. The Template's allowlist now records why drizzle is on a release candidate (with an exit) and why react-router-hono-server stays.

### Patch Changes

- 71a6dd8: The entry points' `*-open.ts` files add their shutdown step through one `resourceOpen` helper in `src/shutdown-step-add.ts`, instead of each spelling out the same step. No behaviour changes.
- 64b75db: Share the helpers the Packages each wrote their own copy of, through the new `@n8io/baseline-shared`.
  - shared: new Package with the timeout race (`sharedTimeLimit`, `sharedTimeRace`), the integer option check (`sharedIntegerAssert`), the 2147483647 timer limit, the server keep-alive timeouts and the Postgres connection checks. It has no dependencies and is for the Packages, not for a Project.
  - redis, cache, live, feature-flags: use the one timeout race instead of six hand-written ones.
  - cache, feature-flags, health, queue, postgres, shutdown, sdk: option errors now come from one formatter, so a bad number reads `<function>: <option> must be a whole number from 1 to N, found X` (or `, N or more`); the same inputs still throw a `TypeError`.
  - health, http: one owner for the 65 s keep-alive; `httpServerKeepAlive` is unchanged.
  - queue, postgres: one copy of the Postgres URL and TLS checks.
  - sdk: ky does the waiting on `Retry-After` and rate-limit headers; the hand-written backoff and header parsing are gone. A wait that runs past `totalTimeoutMs` now ends in the `TimeoutError` instead of resolving the 429 or 503 at once.
- 8745155: Tidy feature flags and secure headers.
  - http: remove the `httpSecureHeaders` constant. Use `httpSecureHeadersCreate()` (same headers, no extra origins).
  - feature-flags: drop the unused `@openfeature/core` peer and the `@n8io/baseline-telemetry` dependency (the evaluation log record now goes through `@opentelemetry/api`, an optional peer of the server adapter); add the `/launchdarkly/origins` entry so a server loads the CSP origins without the browser SDKs (`/launchdarkly/client` still re-exports it); throw a `TypeError` from both factories on an empty key or a `readyTimeoutMs` that is not a whole number of milliseconds from 1 to 2147483647 (0, negative and fractional values were accepted before, and now fail at boot); record evaluations under the instrumentation scope `@n8io/baseline-feature-flags` instead of `@n8io/baseline-telemetry`; export `FeatureFlagsFallbackOptions`, `FeatureFlagsOnFallback` and `FeatureFlagsLaunchDarklyClientVendorOptions`.
  - feature-flags, sdk, live, authn: add `sideEffects: false` so bundlers can tree-shake them.
- Updated dependencies [da3de3f]
- Updated dependencies [da3de3f]
- Updated dependencies [da3de3f]
- Updated dependencies [da3de3f]
- Updated dependencies [64b75db]
- Updated dependencies [da3de3f]
- Updated dependencies [8745155]
  - @n8io/baseline-authn@7.2.0
  - @n8io/baseline-cache@6.4.0
  - @n8io/baseline-http@4.0.0
  - @n8io/baseline-live@7.4.0
  - @n8io/baseline-feature-flags@1.1.0
  - @n8io/baseline-health@2.1.2
  - @n8io/baseline-postgres@6.0.1
  - @n8io/baseline-queue@9.1.1
  - @n8io/baseline-redis@1.1.2
  - @n8io/baseline-shutdown@3.3.0

## 16.2.2

### Patch Changes

- f3df14a: Run the `pieces` check of `app-ci.yml` as one job per piece (`piece (<name>)`), so it no longer outgrows its 10 minute limit as pieces are added. `pieces` stays the one required check: it passes when every piece job passed or was skipped. `pnpm piece-check --skip-tree` leaves out the unmodified-tree check that `check` and `unit` already run. `test/app-ci-pieces.test.ts` keeps the matrix equal to `pieceNames`.

## 16.2.1

### Patch Changes

- 7425f3b: Test the browser feature flag startup that `entry.client.tsx` runs. The wiring now lives in `featureFlagsBrowserStart({ page, tree, create? })` in `src/ui/feature-flags-browser.tsx`, with tests for a page that has the config script, one without it, one with only React Router's state (the earlier bug) and a malformed script. Architecture rule A35 fails if `entry.client.tsx` reads `__reactRouterContext`.

## 16.2.0

### Minor Changes

- db32212: Wire feature flags into the Template's browser. `src/ui/entry.client.tsx` waits for the flags to be ready before it hydrates and wraps the app in `FeatureFlagsProvider`, `src/ui/feature-flags.ts` holds the typed `useFeatureFlag`, and the root loader sends the Actor's id and the new `LAUNCHDARKLY_CLIENT_SIDE_ID` to the browser. Without the ID, or a signed-in Actor, every flag reads as its declared fallback and nothing is requested. `pnpm piece-remove feature-flags` removes all of it. The piece-marker budget is now 93. A Project adds the `server.ts` `getLoadContext` block and `root.tsx` loader block by hand, and sets `LAUNCHDARKLY_CLIENT_SIDE_ID` where it sets `LAUNCHDARKLY_SDK_KEY`.
- d39806b: The `feature-flags` piece: flags declared once in `src/flags.ts`, opened in `src/feature-flags-open.ts` (LaunchDarkly with `LAUNCHDARKLY_SDK_KEY`, else every flag answers its fallback) and shared through `connections.featureFlags`. `pnpm piece-remove feature-flags` takes it out.
- cff7b84: Lint and architecture rules for feature flags: only `@n8io/baseline-feature-flags` imports a flag vendor's SDK (A31, a Biome plugin), `featureFlagsDefine` is called only in `src/flags.ts` (A32), a flag key is written as a string literal only there (A33), and a flag value is never cast with `as` (A34).

### Patch Changes

- 6708e7e: Fix the browser feature flag client never starting. `entry.client.tsx` read the client config from React Router's state before hydration had built it, so no client was made and every browser flag read its fallback. The server now renders the config into the page head as a JSON `<script id="feature-flags-config">` (`FeatureFlagsConfigScript`), and `entry.client.tsx` reads it from the document. The piece-marker budget is now 94. A Project that added the feature flags blocks by hand adds the `<FeatureFlagsConfigScript />` block to the `Layout` head in `src/ui/root.tsx`.
- c470b6a: Fix the browser feature flag client being blocked by the Content Security Policy: `connect-src` now allows LaunchDarkly's origins (`featureFlagsLaunchDarklyClientOrigins()`) when `LAUNCHDARKLY_CLIENT_SIDE_ID` is set, and only then. `src/server.ts` uses `httpSecureHeadersCreate`. The policy always names `connect-src 'self'`. The piece-marker budget is now 95 (7 in `server.ts`). A Project that added the feature flags blocks by hand adds the `connectSrc` block to `src/server.ts`.
- 9e9a446: Docs: `docs/agents/feature-flags.md` (rules for agents, adding a flag or a kind, the browser wiring) with a line in AGENTS.md, and the Feature flag and Flag kind terms in the glossary.
- Updated dependencies [c470b6a]
- Updated dependencies [0656a01]
- Updated dependencies [9e9a446]
- Updated dependencies [83199aa]
- Updated dependencies [d39806b]
- Updated dependencies [c1e2bdb]
- Updated dependencies [8629dd4]
- Updated dependencies [35a01d4]
- Updated dependencies [f5a3df9]
- Updated dependencies [c470b6a]
  - @n8io/baseline-feature-flags@1.0.0
  - @n8io/baseline-telemetry@2.1.0
  - @n8io/baseline-http@3.2.0

## 16.1.0

### Minor Changes

- c1dee86: Four rules move from the Vitest architecture tests into Biome GritQL plugins under `lint-plugins/`, wired through `overrides` in `biome.json`, so `pnpm check` and the editor report them: A15 (`sql.raw` in `adapters/outbound/`), A26 (system time in a Use case), the `process.env` part of A22, and the ban on mocks, spies and fake timers in tests. Messages keep the A-number. `lint-plugin-samples/` holds one failing sample per plugin, run by `lint-plugins.test.ts`. To upgrade a Project: run `pnpm template-upgrade`; keep your own `biome.json` overrides next to the new ones.
- c1dee86: The import rules A2 (domain imports), A7 (`@hono` in domain), A9 (logger), A10 (UI and contexts), A19 (memory adapters), A21 (shared Packages in business code) and A24 (Package `/testing` helpers) move from the architecture test to `noRestrictedImports` overrides in `biome.json`, so `pnpm check` and the editor report them. The overrides skip test files and cannot tell `import type` from a value import: A2 now allows the id and authn Packages by name, and A21 allows `Inbox` and `Actor` by name. Keep your own `noRestrictedImports` entries in the matching override when you upgrade.
- c1dee86: A Biome plugin, `lint-plugins/max-params.grit`, fails a default-exported function with three or more inputs, which Biome's `useMaxParams` skips. It takes one typed object like every other function. Function types are already checked by `useMaxParams`; method signatures in types are still not.
- 03cb19e: `pnpm template-upgrade` handles a big rename better. A release lists what it renamed in `template-renames.json` (names, import paths, files) and the upgrade applies it to your own code after the merge, naming the files it changed. In `CONTEXT-MAP.md` it keeps your rows when the Template changes a table's columns. On a conflict it says the merge is left staged (do not run it again) and lists, per file, the lines only your side has, so an import lost in a conflict block shows up. `docs/agents/template-upgrade.md` says the same. To upgrade a Project: nothing to do; these apply from the upgrade after the one that brings them.

### Patch Changes

- c1dee86: Baseline's own maintenance gains two scripts, `pnpm ci:watch <pr>` and `pnpm release:verify`; Projects are not affected.

## 16.0.0

### Major Changes

- 93cba39: The Template uses plain, model-first terms (ADR 0012). Aggregate, Aggregate root and Entity become Model; Transition becomes Model function, and a predicate is a model function named model first, then `Is`, `Has` or `Can` (`fooCanUpdate`, `fooCanDelete`); Composition root becomes Entry point; Published language becomes Public contract; Part becomes Option. The Seam, Module, Interface, Intake, Specification and Subdomain glossary entries are gone. `pnpm aggregate-create` is now `pnpm model-create`, its `aggregate-create-start:` markers are `model-create-start:`, and `AggregateOption` is `ModelOption`. Architecture rule A23 now fails a predicate that does not read model first (`invoicePaidIs`), and the A28 and A29 messages say Model.

  To upgrade a Project: run `pnpm template-upgrade`; it will conflict on `CONTEXT.md` because the glossary changed, so take the Template's terms and keep your own context terms. The `CONTEXT-MAP.md` table lost its Subdomain column; drop it from your copy. Use `pnpm model-create` instead of `pnpm aggregate-create`. Rename your predicates to model first (`invoiceDeleteCan` to `invoiceCanDelete`, `invoicePaidIs` to `invoiceIsPaid`) and update their callers; `pnpm check` lists each A23 hit. Update your own glossary and docs to the new terms.

### Patch Changes

- Updated dependencies [93cba39]
  - @n8io/baseline-postgres@6.0.0

## 15.0.1

### Patch Changes

- 41e5558: `pnpm template-upgrade` stops silently dropping what a Project still uses, and applies each release's own export. After the merge it checks every package the Template removed from `package.json` against the Project's `src/`, `test/`, `scripts/` and `clients/`; when code still imports one it names the package and the files, says to `pnpm add` it and restore its `dependencies-allowed.json` line, and stops before the install would prune it. It also exports each release with that release's own `templateExport` (as it already rendered with the release's own render code), so a release's change to the workspace block or the client pins reaches the Project; this applies from the upgrade after the one that brings this release, since that upgrade still runs the Project's old scripts. `glossary-check` lets a context use the terms of a context it has an ACL to and any term its own `CONTEXT.md` uses. The agent docs and `compose.yaml` write `pnpm exec varlock run -- docker compose`, because varlock is a devDependency, not a global command; a test fails a bare `varlock` command in an agent doc.

  To upgrade a Project: nothing to do.

## 15.0.0

### Major Changes

- e73c8c4: New architecture rule A30: a function never edits its input (no property assignment, `delete`, or push/sort/splice and the like on a parameter), unless `// mutates: <why>` sits right above it. The Template follows it: `analyticsOpen`, `errorTrackingOpen`, `liveHubOpen`, `queueOpen` and `redisOpen` take the shutdown steps so far and return them with their own added (`ShutdownSteps` from `src/shutdown-step-add.ts`), `liveHubOpen` takes `role`, and `connectionsOpen` assembles them. After upgrading, run `pnpm test` and fix what A30 names.

### Minor Changes

- 348eea5: Template tidy-up from the final consistency audit. A `*.test.tsx` file now runs and is placement-checked like a `.test.ts`. `pnpm api-check`, `pnpm sdk-generate` and `pnpm check` take `--help` (sdk-generate used to run and rewrite files), every help line reads "this help", and scripts shell out through `processRun`/`gitRun` except where an exit status is the answer. Scripts share `argsFail` from `scripts/args.ts`; `nextStepsText` is `aggregateNextStepsText`. Optional script inputs take `null`. Glossary words are capitalised in messages and the generator-copied comments. Docs: a new docs/agents/ports.md (calling a service outside the app), where a new Event is defined, the piece-marker rule behind a "writing code that uses one" trigger, Worker and Server capitalised, `_Avoid_` aliases that no longer collide with the docs.

  To upgrade a Project: a script of your own that imported `nextStepsText` from aggregate-create.ts imports `aggregateNextStepsText`.
- 3e45f69: The Template's domain types are readonly: `Foo`, `Bar`, their inputs and Events are `Readonly<z.infer<...>>`, `FooList.items` is `readonly Foo[]`, and `listByFooId` and `bar-list` return `readonly Bar[]`. The memory repository stores a new Foo instead of editing one. A Project that edits a Foo or a returned list copies it first. A root test (`test/readonly-types.test.ts`) fails a mutable array, Map or Set in an exported Package signature.

### Patch Changes

- 1dd4cd8: The API reference page and `pnpm piece-remove` read `package.json`, `dependencies-allowed.json` and `biome.json` with a Zod schema instead of a type cast, so a file of the wrong shape fails with a message that names the field.
- fcf1de0: `fast-check` is a dev dependency, for property tests beside the unit tests (`src/cursor-property.test.ts` shows the shape: round trips and paging order over generated inputs).
- d5953b6: src/blocked-keys.ts takes its blocked key type from `QueueBlockedKey` in `@n8io/baseline-queue`.
- f0993b4: Turn on the noFallthroughCasesInSwitch, noImplicitReturns and noPropertyAccessFromIndexSignature compiler flags and the Biome noFloatingPromises, noMisusedPromises, useAwaitThenable and useExhaustiveSwitchCases rules. Biome useLiteralKeys is off because it rewrites the bracket access the new flag requires. The architecture test now awaits `init()` from es-module-lexer.
- Updated dependencies [1dd4cd8]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [d5953b6]
- Updated dependencies [3e45f69]
- Updated dependencies [3e45f69]
- Updated dependencies [3e45f69]
- Updated dependencies [3e45f69]
- Updated dependencies [3e45f69]
- Updated dependencies [f0993b4]
- Updated dependencies [f0993b4]
- Updated dependencies [f0993b4]
  - @n8io/baseline-authn@7.1.0
  - @n8io/baseline-analytics@2.1.1
  - @n8io/baseline-cache@6.3.1
  - @n8io/baseline-error-tracking@1.1.1
  - @n8io/baseline-health@2.1.1
  - @n8io/baseline-http@3.1.0
  - @n8io/baseline-live@7.3.1
  - @n8io/baseline-logger@3.1.3
  - @n8io/baseline-postgres@5.5.0
  - @n8io/baseline-queue@9.1.0
  - @n8io/baseline-redis@1.1.1
  - @n8io/baseline-shutdown@3.2.0
  - @n8io/baseline-telemetry@2.0.3

## 14.0.0

### Major Changes

- 774b1b8: The Template moves to the new `@n8io/baseline-authn` major: `src/ui/context.ts`, `src/ui/root.tsx` and `src/ui/routes/router-test-context.ts` use `authnExpiresAtContext`, and every `authnMemoryTokenFetch` and `authnTestSignIn` call passes `baseUrl` (`scripts/api-smoke.ts`, `test/integration/*`). `docs/agents/authn.md` opens the app at the URL `pnpm dev` prints instead of `localhost:3000`.

  To upgrade a Project: run `pnpm template-upgrade`. Then, in your own code, rename `authnExpiryContext` to `authnExpiresAtContext`; pass `baseUrl` instead of `url` to `authnMemoryTokenFetch`, `authnMemoryAuthorizationCreate` and `authnTestSignIn`; pass `renewMs` (milliseconds) instead of `renewSeconds`; read `AuthnMemoryToken.expiresAt` as epoch ms; and import `authnTestTokenCreate` from `@n8io/baseline-authn/testing` where a test called `authnMemoryTokenCreate`.
- 59c2be8: Architecture rule A23 now checks file names: a file is named after its primary export without `Create` (`invoice-routes.ts` exports `invoiceRoutesCreate`), or after the subject its exports share (`cursor.ts` exports `cursorEncode`). An outbound adapter's dot is a word break (`invoice-repository.postgres.ts` exports `invoiceRepositoryPostgresCreate`), React Router's `.server`/`.client` suffix is left out, and a test helper file `<area>-test-<thing>.ts` is named after its area. Tests, `index.ts`, `scripts/`, the composition roots, `<aggregate>-table.ts`, the generated SDK and files exporting only types, classes, components, hooks and React Router's own names (`loader`, `action`, `meta`, `headers`, `links`, `handle`, `shouldRevalidate` and the rest) are not checked.

  To upgrade a Project: run `pnpm check`; for each file it names, rename the file after its primary export, or rename its exports to start with the file's name.

  `pnpm api-smoke` now defaults `--url` to `http://localhost:$PORT`, the port this worktree's `pnpm dev` serves on, instead of port 3000.
- 1270d49: The Template closes the queue with `queue.close()` and records Events in its memory transaction with `queueEventsPublisherMemoryCreate`, the names `@n8io/baseline-queue` 9 uses. After the upgrade, rename both in each context's own code: `queue.stop()` becomes `queue.close()` in its repository and Use case Postgres tests, and `queueEventsMemoryCreate` becomes `queueEventsPublisherMemoryCreate` in `adapters/outbound/<aggregate>-transaction.memory.ts` (see the Template's `foo-transaction.memory.ts`).
- f216435: The SDK piece runs on `@n8io/baseline-sdk` 2: a caller that sets the SDK's timeouts passes `timeoutMs` and `totalTimeoutMs`, not `timeout` and `totalTimeout`, for one call or in `sdkConfigure`. `docs/agents/clients.md` opens with when to read it.
- 5d5a546: The Template's code follows its own naming and testing rules more closely.
  - `src/use-cases.ts` is now `src/contexts.ts`, named after `contextsCreate`. `pnpm template-upgrade` moves it; then change each import of `use-cases.ts` in your own contexts' tests to `contexts.ts`.
  - `structure.test.ts` now fails a test that uses `vi` (mocks, spies, fake timers, stubbed globals; `vi.waitFor` and `vi.waitUntil` stay allowed). The check ran only in the baseline repository before, so a Project now runs it too: replace any `vi.*` in your tests with a memory adapter or a hand-written double on a connection.
  - `structure.test.ts` also fails a `package.json` script that starts with `node` without `--import ./scripts/node-version-require.ts`. `dev`, `dev:prune`, `dev:reset`, `migrate`, `seed`, `blocked-keys` and `test:integration` now preload it, so an older Node stops with "This script needs Node 26" instead of a syntax error. Add it to any `node` script of your own.
  - Test helpers carry their file's prefix: `routerTestContextCreate` and `routerTestArgsCreate` (`src/ui/routes/router-test-context.ts`), `otlpReceiver*` (`test/integration/otlp-receiver.ts`), `productionServer*` (`test/integration/production-server.ts`) and `cspNonce`. Rename them in your own page and integration tests.
  - `analyticsOpen` takes `token?: string | null` and `errorTrackingOpen` takes `dsn?: string | null`.
  - `connectionsClose(connections)` in `src/connections.ts` closes intakes, then resources; the seed, `blocked-keys` and the dev server's re-run use it.
  - `fooCacheCreate(store)` in `foo-cached.ts` holds the cache's key, prefix and schema once, for the real and memory ports.
  - The memory Bar repository breaks `createdAt` ties by id as Postgres orders the uuid, and the contract test holds both to it.
  - The foo list page answers a taken name with `fooErrorStatus.FooNameTaken`, not a literal 409. The bar list operation's summary is "List one foo's bars, oldest first" (it never paged).
  - `lucide-react` is no longer a dependency: no Template component used it. A Project whose components import it keeps its `package.json` and `dependencies-allowed.json` lines when `pnpm template-upgrade` conflicts on them; one that adds an icon later adds both back (`pnpm exec shadcn add` installs it, and `dependencies-allowed.test.ts` asks for the reason).
  - `pnpm api-check` drops two shims for bases older than app@8.1.0 (`problemCodesOpen`, `securityBearerDeclare`); the boolean one names app@13.0.0 as its end.
  - A22 no longer lists `src/authn.ts` among the files that may read `#env` (it never did).
  - Words: scripts and comments say context, not domain, and Event handler, not consumer.

### Minor Changes

- f9fa362: The Template's scripts share one shape. Every command that takes arguments reads them through `scripts/args.ts`: `--help` and `-h` print its usage, an unknown option or a wrong number of arguments prints the usage and exits 1 (`glossary-check`, `piece-check`, `template-upgrade` and `clients-release` used to misread or ignore them). Commands set `process.exitCode` instead of calling `process.exit`. The Pieces live once in `scripts/pieces.ts` (each Piece's name, packages and removal steps), which `aggregate-create`, `context-create`, `piece-check`, `template-upgrade` and the now small `scripts/piece-remove.ts` command read; a new Piece fails type-checking until each says what it does. Shell commands run through `processRun` and `gitRun` in `scripts/process-run.ts`.

  To upgrade a Project: a script of your own that imported a Template script's helper imports it from its new home: `run` (template-render.ts) is `processRun` and `git` (dev-instance.ts) is `gitRun`, both in `scripts/process-run.ts`; `piecesRemovedFind`, `pieceBlocksRemove` and the rest of piece-remove.ts's helpers are in `scripts/pieces.ts` (`piecesGoneFind` is `piecesRemovedFind`, `toolRun` is `pnpmRun`). If you listed a Project's own files in `scripts/piece-remove.ts`, move them to `pieceFiles` in `.template.json` (docs/agents/pieces.md).
- 4d33f36: A Project now checks the names of its `scripts/`, `test/`, `clients/` and top-level files with A23 too (`structure.test.ts`), not only `src/`. To upgrade a Project: run `pnpm test`; for each name it lists, rename as the message says.

  `pnpm context-create` and `pnpm aggregate-create` refuse only names with the word foo (the Template's example name, which the render renames), so `food` or `football` work. The routes answer a Use case's error through one helper beside them (`fooHttpErrorAnswer` in `adapters/inbound/foo-http.ts`), and the live route file is `foo-live-routes.ts`. Rule messages for A7 and A8 point at the right files (`<aggregate>-routes.ts`, the context's `index.ts`), and the composition roots are one list in the rules, as CONTEXT.md names them.

### Patch Changes

- 09b2747: Docs follow-ups: the SDK and CLI usage moved from `docs/agents/pieces.md` to `docs/agents/clients.md` ("Using them"), `lucide-react` is pre-approved in `dependency-updates.md`, the Read-when triggers in `AGENTS.md` now reach transitions, Use cases, repositories and lists, the glossary gains **Scope**, and the Baseline terms ban the same aliases as baseline's root glossary.
- d4bf428: Make the Template's docs and glossary match the code. The glossary gains Transition, Server, Piece, Part, "Short form: Event" and a Baseline section (Project, Template, Package, Template upgrade), and its `_Avoid_` lists name only the phrase that is the mistake. AGENTS.md states the outbound adapter file suffix, schema casing, the `// unreachable:` escape and the no-mocks rule, and gives each Aggregate's error statuses a row. The README lists the SDK and CLI pieces and the `sdk-generate` and `api-smoke` commands. Seed rules live in one section of context-create.md, locking rules only in data.md, and cached-read rules in data.md; scripts.md shows the real package.json line with the Node guard; vendor-settings.md lists what `queueMigrate` and `queueSchedulesSync` take.
- Updated dependencies [bfb7735]
- Updated dependencies [59c2be8]
- Updated dependencies [774b1b8]
- Updated dependencies [3af66e4]
- Updated dependencies [bfb7735]
- Updated dependencies [d580a34]
- Updated dependencies [d580a34]
- Updated dependencies [d580a34]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [84c85e1]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [e7bc75a]
- Updated dependencies [3af66e4]
- Updated dependencies [bfb7735]
- Updated dependencies [9a5b1a1]
- Updated dependencies [1270d49]
- Updated dependencies [1270d49]
- Updated dependencies [3af66e4]
- Updated dependencies [d580a34]
- Updated dependencies [bfb7735]
- Updated dependencies [59c2be8]
- Updated dependencies [bfb7735]
  - @n8io/baseline-analytics@2.1.0
  - @n8io/baseline-authn@7.0.0
  - @n8io/baseline-cache@6.3.0
  - @n8io/baseline-error-tracking@1.1.0
  - @n8io/baseline-health@2.1.0
  - @n8io/baseline-http@3.0.2
  - @n8io/baseline-id@3.0.2
  - @n8io/baseline-live@7.3.0
  - @n8io/baseline-postgres@5.4.0
  - @n8io/baseline-queue@9.0.0
  - @n8io/baseline-redis@1.1.0
  - @n8io/baseline-shutdown@3.1.0
  - @n8io/baseline-telemetry@2.0.2
  - @n8io/baseline-logger@3.1.2
  - @n8io/baseline-result@1.1.4

## 13.0.0

### Major Changes

- 50194c9: Every route sets a one-line `summary` ("Create one foo", "List foos, one page at a time"…). It is the generated CLI command's help and the generated SDK function's doc comment, and `aggregate-create` writes one for each route it adds. `test/integration/server-wiring.test.ts` now fails on an operation without a summary.

  To upgrade a Project: after `pnpm template-upgrade`, add a one-line `summary` to each of your routes' `createRoute` calls (`pnpm test:integration` names any you missed). If the Project keeps `clients/sdk`, run the `sdk-generate` script and commit `clients/sdk`.

### Minor Changes

- b1a02f4: `pnpm dev:prune` removes the containers and volumes of the dev instances whose linked worktree is gone, so a worktree removed without `pnpm dev:reset` leaves nothing running. `pnpm dev:prune --dry-run` only lists them. An instance counts as gone when the folder compose ran it in no longer exists, its name is the one `pnpm dev` gives that folder, and no worktree git lists uses that name; so the original checkout's stack, another Project's, a moved worktree's and an instance renamed in `.env.development.local` stay. Volumes left by a `docker compose down` without `--volumes` are not found.

  To upgrade a Project: run `pnpm template-upgrade`; it adds `scripts/dev-prune.ts` and the `dev:prune` script.
- 097083e: Boolean query parameters (`count`, `archived`) are documented as `type: boolean` with `default: false`, not as a string, so the generated SDK takes `fooList({ count: true })` and the CLI offers `--count` / `--no-count`. The server still accepts only `true` or `false`, so no request changes. `pnpm api-check` reads an older base document's string-typed booleans as booleans, so the change is not reported as breaking.

  To upgrade a Project: nothing is required. To type your own Aggregates' boolean query parameters too, give each the `.openapi(...)` that `queryBoolean` has in `app@<version>:apps/app/src/contexts/foo/adapters/inbound/foo-routes.ts`, then, if the Project keeps `clients/sdk`, run the `sdk-generate` script and commit `clients/sdk`. SDK callers then pass `true`/`false` instead of `"true"`/`"false"`.
- 40e2b26: The SDK piece runs on `@n8io/baseline-sdk`: every call gets a timeout (10 s per attempt, 30 s in all) and a GET, HEAD or DELETE is retried after a network failure, a timeout or a 408, 429, 500, 502, 503 or 504 (`retry: 0` turns it off, as an Event handler should). A caller picks an Environment by name instead of a URL: `clients/environments.json` lists them (the Template ships `development`, rendered at the Project's own `PORT`), `sdkConfigure({ environment })` takes one, typed, and the `sdk-generate` script writes them into `clients/sdk/openapi.json` as `servers`, where the CLI's `--env` finds them. `baseUrl` stays as an override for tests and worktrees. `clients-release` now publishes the SDK and CLI to GitHub Packages on the Project's own repository with the workflow's `GITHUB_TOKEN`, never to public npm, so no first publish by hand or trusted publisher is needed (a Project that published to public npm starts again at `<major>.0.0` there); `docs/agents/clients.md` says how another repository installs them. Environment is a new glossary term.
- 91703a9: Each linked git worktree of a Project now runs `pnpm dev` as its own dev instance, so several worktrees run at once with no shared containers, volumes, data, ports or cookies. The first `pnpm dev` (or `pnpm dev:reset`) in a worktree writes its compose project, `<project>-<worktree folder>`, and its own ports to `.env.development.local`, once; edit a port there on a clash, and run `pnpm dev:reset` before removing the worktree. `pnpm test:integration` in that worktree uses its Postgres and Redis. The original checkout keeps the Project's name, ports and data.
  - `.env.schema` has a new `COMPOSE_PROJECT_NAME` (the Project's name), which `varlock run` hands to `docker compose`; compose commands no longer pass `-p`.
  - With the UI, the dev server listens on `PORT` (no longer Vite's 5173) and fails if it is taken. Open the URL it prints, `http://<instance>.localhost:<PORT>/`, so each instance keeps its own sign-in. A Project that signs in through a real issuer (`AUTHN_ISSUER_URL`) in development registers that URL's `/auth/callback` there.
  - The dev Worker serves health on `HEALTH_PORT + 1`, which is the port it had.

  To upgrade a Project: run `pnpm template-upgrade`. If `package.json` conflicts on `dev` or `dev:reset`, take the Template's scripts: your own Worker `HEALTH_PORT=<port>` is now `HEALTH_PORT + 1` from `.env.development`, so only an edited Worker port needs that `HEALTH_PORT` changed to one below it. Run compose by hand as `varlock run -- docker compose …`, without `-p`.

### Patch Changes

- d6c9261: An `/api` DELETE with no body, or a chunked request, no longer answers 500 on the Node server (production build and `pnpm dev`). hono's bodyLimit copies a request whose length it must measure with `new Request(raw, init)`, and the Node adapter's request is not a native one; `src/server.ts` now hands it a native copy first. A body over 1 MB still answers 413 `PayloadTooLarge`.
- d626b28: app-create no longer renders the Template's `pnpm-lock.yaml`, whose integrity hashes can hold "Foo" by chance. The render dropped such a line, so pnpm ignored the broken lockfile and a new Project resolved every dependency fresh.

  To upgrade a Project: nothing is required.

## 12.0.0

### Major Changes

- c285793: Aggregates guard their own invariants. Each Aggregate's `domain/<aggregate>.ts` now holds its schemas, its transitions (pure functions that make or change it and return `Result`) and its specifications (predicates ending `Is`, `Has` or `Can`); the one-file Rules are gone. In the Template, `foo-update-can.ts`, `foo-delete-can.ts` and `foo-stale-is.ts` fold into `domain/foo.ts` as `fooUpdateCan`, `fooDeleteCan` and `fooStaleBefore` (the unused `fooStaleIs` is dropped), beside the new `fooNew` and `fooRename(foo, { actor, name, now })`, which returns `FooForbiddenError` itself; Bar gets `barNew`. A Use case loads, calls a transition, saves what it returns and publishes. `aggregate-create` writes this shape. Architecture rules: the new A29 fails a non-test `application/` file that types a literal as an Aggregate root, casts to one, spreads or assigns to a variable named for one or loaded by a repository `find…`, or hands a literal to its repository's `insert`/`update`; A2 lets `domain/` import the result package's values (`ok`, `err`); A3 and A4 fail an adapter that imports a function from its context's `domain/` (a transition or specification), directly, through `index.ts` or by a namespace import; A27's message for `domain/` now says a transition returns `err(...)`. `structure.test.ts` term-checks each Aggregate's `domain/` file even with a test beside it. A set-based repository write (a Schedule's single `UPDATE ... WHERE`, an Event handler's cleanup) stays the one change that skips the transitions (`docs/agents/schedules.md`).

  To upgrade a Project: after `pnpm template-upgrade`, for each Aggregate move its Rule files (`domain/<aggregate>-*.ts`) into `domain/<aggregate>.ts` and fix the imports. Then run `pnpm check` and `pnpm test`: for each A29 hit, write a transition in `domain/<aggregate>.ts` (`<aggregate>New` for a new one, a verb such as `<aggregate>Rename` for a change, taking the Actor and the time as inputs and returning `err(...)` for a forbidden or invalid change) and have the Use case call it and save its value; for each A3 or A4 hit, move the logic into a Use case, or repeat a predicate in the memory adapter and hold it equal to Postgres in the repository contract test. Fold each Rule test into a Use case test where one already covers it, and keep the rest as tests of `domain/<aggregate>.ts`. `app@<this version>:apps/app/src/contexts/foo/domain/` shows the shape.
- d456efc: Bridges are replaced by anti-corruption layers (ACLs), and Outcome Events are named a saga. `src/bridges/` and the `#bridges/*` import alias are gone. A context that reads another holds the read in its own `adapters/outbound/<context>-<upstream>-acl.ts`, which imports only the upstream's `index.ts`, calls its `*Get` or `*List` Use cases with its own machine Actor and returns the downstream's own shape. Its slot in the ports is `<context><Upstream>Acl` in `application/ports.ts` (was `<context><Upstream>Reader`); the `<Context>Readers` type, the reader memory fakes and their exports are gone. `<context>ContextCreate({ connections, upstream })`, `<context>PortsCreate(connections, upstream)` and `<context>PortsMemoryCreate(upstream)` take the upstream contexts themselves (`upstream: { customer: customerContext }` in `src/use-cases.ts`), typed `<Context>Upstream` in `adapters/outbound/index.ts`. The Template's `index.ts` exports `<Context>Context`, the type its `<context>ContextCreate` returns, so a new context can be an upstream. Tests build the real upstream on memory adapters with the test helper `<context>TestUpstreamCreate()` in `adapters/outbound/<context>-test-upstream.ts`, pass it to every `<context>PortsMemoryCreate(upstream)` call, and create the rows they need through the upstream's Use cases. `pnpm context-create <context> --reads <upstream>` writes all of this. Architecture rule A11 now checks ACLs: one upstream, through its `index.ts`, `*Get` and `*List` Use cases only. A6 lets an ACL import its upstream's `index.ts`, and a seed import the types of a context its context has an ACL for, so a downstream seed can list upstream rows through `upstream`, which it gets in `index.ts`. Inside a context only tests and test helpers may import `src/use-cases.ts` or `src/connections.ts`. `docs/agents/bridges.md` is now `docs/agents/acl.md`, with a Saga section in place of Outcome Events.

  To upgrade a Project: for each Bridge `src/bridges/<context>-<upstream>-reader.ts`, move it to `src/contexts/<context>/adapters/outbound/<context>-<upstream>-acl.ts` and rename it `<context><Upstream>AclCreate`, taking `Pick<<Upstream>Context, "useCases">` (add `export type <Upstream>Context = ReturnType<typeof <upstream>ContextCreate>;` to the upstream's `index.ts`). Rename the reader port to `<context><Upstream>Acl`, delete `<Context>Readers` and the reader's memory fake, and follow `app@<this version>`'s `pnpm context-create <context> --reads <upstream>` output for the rest: `<Context>Upstream` and the ACL in `<context>PortsCreate` and `<context>PortsMemoryCreate`, `upstream: { <upstream>: <upstream>Context }` in `contextsCreate`, and `<context>TestUpstreamCreate` passed to every `<context>PortsMemoryCreate` call in its tests; tests that used the fake now create upstream rows through the upstream's Use cases. Drop `#bridges/*` from `package.json` `imports` and delete `src/bridges/`. `pnpm check` and `pnpm test` name what is left: A6 for a context file that still imports another context, A11 for an ACL that writes.
- 42bb793: The Template's code now sits in bounded contexts: `src/domains/<name>/` is `src/contexts/<name>/`, with four layers inside. `models/` and `rules/` are `domain/`, beside `domain/errors.ts` (was `<name>-errors.ts`) and `domain/repositories.ts` (the repository ports from `ports.ts`). `use-cases/` is `application/`, beside `application/ports.ts` (the other ports). `api/` is `adapters/inbound/`, where a Consumer is now an Event handler named `*-handler.ts`, and `spi/` is `adapters/outbound/`. The `#domains/*` import is `#contexts/*`, the `unit-domains` Vitest project is `unit-contexts`, and the architecture rules, `structure.test.ts`, `domain-create`, `piece-remove` and the Drizzle schema glob read the new folders. The API's tags and operationIds do not change.

  To upgrade a Project: after `pnpm template-upgrade`, for each folder in `src/domains/`, `git mv` it to `src/contexts/`, `mkdir domain adapters` inside it (git mv makes no parent folders), and `git mv models/*` and `rules/*` to `domain/`, `<name>-errors.ts` to `domain/errors.ts`, `use-cases/` to `application/`, `ports.ts` to `application/ports.ts`, `api/` to `adapters/inbound/` and `spi/` to `adapters/outbound/`. Move the repository port types (`<Name>ReadRepository`, `<Name>Repository` and its error unions) from `application/ports.ts` to `domain/repositories.ts`, export both files from `index.ts` with `export type *`, and rename each `*-consumer.ts` to `*-handler.ts` (and its `…ConsumerCreate` export to `…HandlerCreate`). Then replace `#domains/` with `#contexts/` everywhere, fix the relative imports `pnpm check` reports (adapter files sit one folder deeper), and run `pnpm check`, `pnpm test` and `pnpm test:integration`. Three checks reach further now: A2 (pure imports: its own `domain/`, Zod, `src/id-schema.ts` and the authn, id and result types) and A27 (no throw or catch) cover all of `domain/`, not only the Rules, so move a model's other imports or throws to a Use case; and `structure.test.ts` asks for a glossary term for each `domain/` file that has no test beside it (a model), not for a Rule, errors.ts or repositories.ts. `app@<this version>:apps/app/src/contexts/foo/` shows every file in its new place.
- 9783bdd: A bounded context can hold several Aggregates. `pnpm domain-create` is replaced by two commands: `pnpm context-create <context> [--reads <context>]` writes a context's shell (its entry, ports, transaction, Use cases, adapters' entries, a `CONTEXT.md` stub and its wiring), and `pnpm aggregate-create <context> <aggregate>` adds an Aggregate to it with the part flags `--bare`, `--analytics`, `--cache`, `--live`, `--pages`, `--schedule` and `--seed`. `docs/agents/domain-create.md` is now `docs/agents/context-create.md`. The marker comments are renamed: `// domain-create: <slot>` is `// wiring: <slot>` (`# wiring:` in `.env.schema`) and `domains-start`/`domains-end` are `wiring: contexts-start`/`wiring: contexts-end`. The Template's `foo` context gains a second Aggregate, Bar, a note on one Foo that is deleted with it. Architecture rules: A23 lets a context's export start with one of its Aggregates' names, A14 asks for a deleted handler only for an id from another context (its context or one of its Aggregates), A16 lets a span attribute name the Aggregate, and the new A28 fails a transaction whose work reaches two Aggregates' repositories without a `// invariant: <what>` comment right above it. An Aggregate is a `domain/<name>.ts` model with its own `adapters/outbound/<name>-table.ts`; `structure.test.ts` allows a `CONTEXT.md` and each Aggregate's `<name>-error-status.ts` at a context root. Only a context's first table exports its `pgSchema`, since drizzle-kit refuses two exported schemas of one name.

  To upgrade a Project: after `pnpm template-upgrade`, replace `domain-create:` with `wiring:` and `domains-start`/`domains-end` with `wiring: contexts-start`/`wiring: contexts-end` in every file outside `src/contexts/`, and where you ran `pnpm domain-create <name>`, now run `pnpm context-create <name>` and then `pnpm aggregate-create <name> <name>`. For `aggregate-create` to add a second Aggregate to a context made by `domain-create`, give that context's shared files the `// wiring: <slot>` markers `app@<this version>:apps/app/src/contexts/foo/` has (`repositories`, `errors`, `ports`, `transaction-ports`, `use-cases`, `exports`, `read-repositories` and the memory state's), and move the memory state from `<name>-repository.memory.ts` into `<name>-transaction.memory.ts` as foo has it. Then run `pnpm check`: A28 reports any Use case that already writes two Aggregates in one transaction, which needs its `// invariant:` comment.
- b95bbad: Each context is tested through its interface. The Template's Foo tests build the context as the composition roots do, `contextsCreate(connections).fooContext` on memory connections, and call its Use cases, mount its routes, run its schedule and seed, asserting on what comes back and on a later read instead of on memory state. What leaves the context is watched at the connection it leaves through (a recording `analytics`, `liveHub` or `cacheStore` spread into the connections), and Domain events are checked on Postgres through the interface in `foo-transaction.postgres.test.ts`. Only the repository contract, the transaction's commit and rollback, the Postgres races and `application/bar-list.postgres.test.ts` (a foo's bars go with it, which no read can show) still look behind the interface. The memory ports no longer record what analytics and live updates were given. Deleted as repeats: `domain/foo.test.ts` (its two scope cases moved into the update and delete tests), `adapters/outbound/index-foo.test.ts` and `application/foo-use-cases-queue.test.ts`. `Connections` now carries the `clock` (`connectionsOpen` gives the system clock), and each context's `adapters/outbound/index.ts` reads it, so a test sets the time with `{ ...connections, clock: clockMemoryCreate(now) }`. `aggregate-create` copies tests in this shape. New `docs/agents/tests.md`; `apps/app/AGENTS.md` `## Tests` states the rule.

  To upgrade a Project: after `pnpm template-upgrade`, and before the next `pnpm aggregate-create` (its new tests set the time through the connections), in each context's `adapters/outbound/index.ts` change `<context>Clock: clockSystemCreate()` to `<context>Clock: connections.clock` and drop the `clockSystemCreate` import; any test that builds a `Connections` by hand adds `clock`. The Project's existing tests keep passing. Move them to the interface as you touch them: replace `<context>UseCasesCreate(<context>PortsMemoryCreate().ports)` with `contextsCreate(connections).<context>Context.useCases`, and each assertion on `state` with a read through a Use case. Delete `adapters/outbound/index-<aggregate>.test.ts` and `application/<aggregate>-use-cases-queue.test.ts` once their cases sit in interface tests (`docs/agents/tests.md`). `app@<this version>:apps/app/src/contexts/foo/` shows the shape.
- c28228b: Each bounded context has its own language, and `CONTEXT-MAP.md` is a real context map. `CONTEXT.md` now holds only the shared `## Architecture` terms; each context's terms live in `src/contexts/<context>/CONTEXT.md`, which says its subdomain type (`Subdomain: core`, `supporting` or `generic`) above its `## Language`. A Project's new `CONTEXT-MAP.md` lists each context with its subdomain type and its language in a `## Contexts` table, and how contexts relate (downstream, upstream, through an `ACL`, `Domain events` or both) in a `## Relationships` table; `docs/agents/context-create.md` gives the format, and `scripts/glossary-check.test.ts` checks the map against `src/contexts/`. `pnpm context-create <context>` refuses a context the map does not list and writes its `CONTEXT.md` with the map's subdomain type; `pnpm aggregate-create` looks for the Aggregate's `**Term**:` in that context's `CONTEXT.md`. `pnpm glossary-check` now reads the map by default: a file in a context is held to its own language and the shared one, so another context's term is a hit except in the `adapters/` of a context the map lists downstream of it, and an alias written capitalized (`Rule`) matches only that case, so "architecture rule" or "read model" no longer warn.

  To upgrade a Project: `pnpm template-upgrade` brings `CONTEXT-MAP.md` and keeps your terms under `CONTEXT.md`'s `## Language`. Then, for each context, add its row to `CONTEXT-MAP.md`, create `src/contexts/<context>/CONTEXT.md` (a title, `Subdomain: <type>`, a line on what it does, then `## Language`), move its terms there from `CONTEXT.md`, and add a `## Relationships` row for each context it reads through a Bridge or whose Events it handles. Delete `CONTEXT.md`'s `## Language` heading once it is empty. `pnpm test` names what is still missing.
- 6688446: Each bounded context has one interface. A context's `index.ts` now exports `<context>ContextCreate({ connections })`, which picks the context's adapters from the connections, traces its Use cases with `telemetryUseCasesTrace` and returns `{ useCases, routes, handlers, schedules, seeds }` (`handlers` and `schedules` only with the queue piece), plus `<context>Schedules` (the Schedules' names and crons, for migrate) and its Published language: input and error types, Domain event schemas, specifications the UI needs, `<aggregate>ErrorStatus` and `<context>Scopes`. Transitions, ports, repositories and `<context>UseCasesCreate` are no longer exported. `adapters/inbound/index.ts` is gone: `index.ts` imports each inbound adapter, and inbound adapters import `domain/`, `application/` types and the files beside `index.ts`, never `index.ts` itself (a cycle). `src/use-cases.ts` exports `contextsCreate(connections)` (was `domainsUseCasesCreate`), which builds each context after the contexts it reads and returns `{ <context>Context, ... }` (type `Contexts`), and `ContextMounts`, the shape the roots mount. `src/server.ts` mounts every context's `routes` and subscribes its `handlers`, `src/worker.ts` starts every context's `handlers` and `schedules`, `seedsRun(mounts: ContextMounts[])` (was `seedsRun(useCases)`) runs every context's `seeds` in build order (a seed gets only the Actor: seeds that pass rows to each other go in one entry, and a context reads another's rows through its upstream), `src/migrate.ts` syncs each `<context>Schedules`, and `uiLoadContextCreate` takes `contexts`. A context that reads another takes its Bridge-built readers as `upstream`, and its `index.ts` exports the reader types its Bridges implement. Architecture rules: A5 lets outside code import only a context's `index.ts`; A1 and A3 fail business code or an inbound adapter that imports its own context's `index.ts` (a cycle, since `index.ts` imports the adapters); A18 fails a context that `contextsCreate` does not both build and return, and a context `index.ts` that leaves `<context>UseCasesCreate(...)` unwrapped. `structure.test.ts` no longer asks for `adapters/inbound/index.ts`. `context-create` and `aggregate-create` write this shape.

  To upgrade a Project: after `pnpm template-upgrade`, for each context move what its composition-root lines did into its `index.ts` as `<context>ContextCreate`, following `app@<this version>:apps/app/src/contexts/foo/index.ts`: its routes from `src/server.ts`, its Event handlers from `src/server.ts` and `src/worker.ts`, its Schedules from `src/worker.ts` (and `<context>Schedules` for `src/migrate.ts`), its seeds from `src/seed.ts`, and its Use cases build from `src/use-cases.ts`. Then make `contextsCreate` in `src/use-cases.ts` call each `<context>ContextCreate` in build order, passing a reading context its Bridges as `upstream`, delete each `adapters/inbound/index.ts`, make every file inside a context that imported it or the context's `index.ts` import the `domain/`, `application/` or adapter file itself (outside code keeps importing only `index.ts`), and replace `useCases.<context>UseCases` with `contexts.<context>Context.useCases`. `pnpm check` and `pnpm test` name what is left: A5 for an outside import past `index.ts`, A3 for an adapter importing `index.ts`.
- 179b11a: Every runtime dependency now needs an entry in `dependencies-allowed.json`, a one-line reason per package name, and `dependencies-allowed.test.ts` fails on a dependency without one and on an entry no runtime dependency uses. `@n8io/baseline-*` packages are exempt, and a version update changes no entry. `pnpm piece-remove` drops a removed piece's entries, and removing `ui` adds `@hono/node-server`.

  Upgrade: after `pnpm template-upgrade`, run `pnpm test dependencies-allowed`. For each dependency it names that your Project added, add `"<name>": "<reason>"` to `dependencies-allowed.json`; remove each entry it names that your Project no longer uses. See `docs/agents/dependency-updates.md` ("Adding a dependency").
- 2a24202: The agent docs, `AGENTS.md` and the README speak the standard DDD terms the code now uses: bounded context (not Domain), Aggregate root (not Model), transition and specification (not Rule), inbound and outbound adapter (not API layer and SPI), Event handler (not Consumer), anti-corruption layer (not Bridge) and saga (not Outcome Events). Placeholders follow the files they name: `<context>` for a context's files (`<context>-transaction.postgres.ts`, `<context>-error-status.ts`) and `<aggregate>` for an Aggregate's (`<aggregate>-table.ts`, `<aggregate>Schedule`, the `<aggregate>-list.tsx` page). The temporary `_Allowed until_` line is gone from `CONTEXT.md`, so `pnpm glossary-check` now warns on an old word in the lines a branch adds. `glossary-check` also skips a `kind:` value quoted in a text file (`` `kind: "client"` ``), as it already did in code. `pnpm piece-remove queue` now says "Remove your Event handlers first". The README diagram shows the HTTP route, the Postgres adapter, the Domain event and the Event handler.

  To upgrade a Project: nothing is required. `pnpm template-upgrade` brings the new docs; `pnpm glossary-check` now warns on an old word in any line a branch adds, so rename the old words in your own comments, docs and test names as you touch them. A Project README that kept the Template's `## Domains` section can rename it `## Bounded contexts`.
- c28d048: Every API operation now sets `operationId` to the name of the Use case its handler calls (`fooCreate`) and one tag, its Domain in camelCase (`foo`), so a generated SDK or CLI gets readable names. `domain-create` writes both for a new Domain, `info.title` is the Project's package.json `name`, and `server-wiring.test.ts` fails on a missing or duplicate operationId, a tag count other than one, or a tag that is not a Domain. `pnpm api-check` now fails when an operationId or a tag is renamed or removed.

  Upgrade: after `pnpm template-upgrade`, give each `createRoute` in your Domains' `api/*-routes.ts` an `operationId` and a `tags` list the way `app@<this version>:apps/app/src/contexts/foo/adapters/inbound/foo-routes.ts` does (the Use case it calls, and its Domain in camelCase), then run `pnpm test:integration server-wiring`. Adding them is not breaking for clients; renaming them later is.
- d316dd4: A new removable `sdk` piece: a typed TypeScript SDK generated from the API's OpenAPI document, in `clients/sdk` as its own package (`<project>-sdk`). It exports one function per operation, named by its operationId (`invoiceCreate(body)`), each resolving to `{ status, data, headers }` typed by status, and `sdkConfigure({ baseUrl, token })`; callers install no runtime dependency. `pnpm sdk-generate` writes `clients/sdk/openapi.json` from the app's document and `clients/sdk/sdk.ts` from it (orval, a dev dependency, named only in `scripts/sdk-generate.ts`). app-ci's `check` job gains a step that fails when the committed SDK differs from what `pnpm sdk-generate` writes. The Project's `pnpm-workspace.yaml` now lists the root and `clients/*`, with `ignoreWorkspaceRootCheck` so `pnpm add` in the root still adds to the app, and `.dockerignore` keeps `clients/` out of the image. `pnpm piece-remove sdk` takes it all out (`docs/agents/pieces.md`, "The SDK").

  To upgrade a Project: after `pnpm template-upgrade`, run `pnpm install` and `pnpm sdk-generate`, and commit `clients/sdk`: the upgrade brings the SDK of a Project with no routes, and `check` fails until it is generated from yours. Run `pnpm sdk-generate` after every route change from then on. If the Project will never publish an SDK, run `pnpm piece-remove sdk` instead.
- de57d9a: `CONTEXT.md`'s `## Architecture` now uses the standard DDD and hexagonal terms, recorded in the repo's first ADR (`docs/adr/0001-standard-ddd-terms.md`): Bounded context, Aggregate root, Entity, Value object, Invariant, Specification, Domain service, Inbound adapter, Outbound adapter, Domain event, Published language, Event handler, Outbox, Anti-corruption layer, Saga, Projection, Subdomain, Context map and Shared kernel, plus Module, Interface, Seam and Adapter. Domain, Model, Rule, API (as a layer), SPI, Consumer, Bridge and Outcome Events are now `_Avoid_` aliases of their replacements. The code still uses the old words until later releases move it, so a new `_Allowed until <when>_:` line keeps those aliases out of `pnpm glossary-check` for now.

  To upgrade a Project: run `pnpm template-upgrade` and take the Template's `## Architecture` section of `CONTEXT.md` as it is, including the `_Allowed until_` line; keep your own `## Language` terms. Nothing else changes yet: your code, folders and commands stay as they are until the later bounded-context releases.
- 97f64ad: Architecture rule A27: a non-test file under `src/domains/*/use-cases/` or `src/domains/*/rules/` (in this release `src/contexts/*/application/` and `src/contexts/*/domain/`, see the bounded-context entry) never contains `try`, `catch` or `Promise.reject(`, and never `throw`s for an expected outcome. An expected outcome returns `err(new <Name>Error())` and its error joins the Use case's error union; adapters (`spi/`, Packages) throw for the unexpected, and `telemetryUseCasesTrace` records it. The one throw a Use case or Rule keeps is for a bug that cannot happen: `throw new Error(...)` directly under a one-line `// unreachable: <why, in a few words>`, so a request fails with a 500 and a Consumer's Event retries instead of completing with an `err`. Words in comments and strings do not count. Each failure names the file and line and says what to do instead.

  To upgrade a Project: run `pnpm template-upgrade`, then `pnpm test`. For each A27 failure, return the error with `err(...)` instead of throwing it, or, for a throw that guards a bug that cannot happen, make it `throw new Error(...)` and put `// unreachable: <why>` on the line directly above it.

### Minor Changes

- 8949d3a: A new removable `cli` piece: the Project's command line tool in `clients/cli`, its own package (`<project>-cli`) whose command is the Project's name. It hands the SDK's OpenAPI document and functions to `cliCreate` from `@n8io/baseline-cli`, so every operation is a command (`invoiceLineCreate` is `<project> invoice-line create --name x`) with no command code of the Project's own; `login --client-id <id>` stores a token, and `--url` or `<PROJECT>_URL` names the API. The SDK package also exports its `openapi.json`. `pnpm piece-remove cli` takes it out (`docs/agents/pieces.md`, "The CLI"), and `pnpm piece-remove sdk` now refuses until it is gone.

  To upgrade a Project: after `pnpm template-upgrade`, run `pnpm install` and commit `clients/cli` with the lockfile. If the Project will never ship a CLI, run `pnpm piece-remove cli` instead.
- 1f89b9f: The `sdk` piece now publishes the SDK and the command line tool to npm. `.github/workflows/clients-release.yml` runs `scripts/clients-release.ts` on every push to main, which publishes `clients/sdk` as `@<scope>/<project>-sdk` and `clients/cli` as `@<scope>/<project>-cli` at one version, built to JavaScript with type declarations. The major is the API's (`/api/v1` gives 1.x); a change to the generated SDK publishes the next minor, any other change to either package the next patch, and no change nothing. It uses npm trusted publishing (no stored token) and adds provenance when the repository is public. It does nothing, and passes, until the repository variable `CLIENTS_NPM_SCOPE` is set. `docs/agents/clients.md` lists the one-time steps; `pnpm piece-remove sdk` removes the workflow and script with the SDK.

  To upgrade a Project: after `pnpm template-upgrade`, commit the new workflow and script. To publish, follow "Turning it on" in `docs/agents/clients.md`; otherwise leave `CLIENTS_NPM_SCOPE` unset.

### Patch Changes

- Updated dependencies [97f64ad]
  - @n8io/baseline-result@1.1.3

## 11.0.1

### Patch Changes

- 4d26375: `pnpm template-upgrade` formats `.template.json` with Biome before it exits on a conflict, so `pnpm check` no longer fails on it after you resolve the markers. `docs/agents/template-upgrade.md` now says to take either side of a `src/env.d.ts` conflict, since `pnpm check` regenerates it.

## 11.0.0

### Major Changes

- 0a20c02: The Template's secret store is now Infisical (`@varlock/infisical-plugin`) instead of 1Password. `.env.production` holds bare `NAME=infisical()` references, each read from the secret of the same name in the Infisical project's `prod` environment, so the file is the same in every Project and `app-create` no longer rewrites it. A Project that boots with every variable already set in its environment changes nothing at run time.

  To upgrade a Project:
  1. **Before the upgrade**, make your `scripts/template-render.ts` tolerate the plugin swap, and commit it. Your own `template-upgrade` renders this release with your installed tools, which lack the Infisical plugin. In `templateFinish`, wrap the `varlock codegen` `run({...})` call in `try { ... } catch (error) { if (!/Plugin "[^"]+" unable to resolve/.test((error as Error).message)) throw error; }`. The upgrade then brings in the Template's version of that block.
  2. Run `pnpm template-upgrade`. It swaps the dependency, the two `.env.schema` header lines and the `OP_SERVICE_ACCOUNT_TOKEN` item for the four optional `INFISICAL_*` items.
  3. `.env.production` conflicts, because `app-create` wrote your vault name into it: take the Template's side, then add back any line of your own as `NAME=infisical()`, or `NAME=infisical("SECRET_NAME")` where the secret in Infisical has another name. Do the same in any `.env.development.local`. If `src/env.d.ts` conflicts, take either side; `pnpm check` regenerates it. Then run `pnpm install`, `pnpm check` and `pnpm test`.
  4. In Infisical, create a project with a secret for each reference in its `prod` environment, and a machine identity with Universal Auth and read access to that project.
  5. Where the app boots and fetches secrets, set `INFISICAL_PROJECT_ID`, `INFISICAL_CLIENT_ID` and `INFISICAL_CLIENT_SECRET`, plus `INFISICAL_SITE_URL` for a self-hosted Infisical, allow outbound HTTPS to it, and remove `OP_SERVICE_ACCOUNT_TOKEN`. Where every variable is already set in the environment, set none of them.

## 10.2.0

### Minor Changes

- 9d22059: New entry `src/blocked-keys.ts` (`pnpm blocked-keys` locally, `node src/blocked-keys.ts` in a pod): alone it lists the blocked Event keys, and `retry <consumer> <key>` or `give-up <consumer> <key>` releases one. It exits 1 when nothing was released. Part of the queue piece.

### Patch Changes

- 432ec1c: `src/blocked-keys.ts` lists when the queue deletes each blocked key's failed Event unless it is released first.
- Updated dependencies [432ec1c]
- Updated dependencies [9d22059]
- Updated dependencies [2fb6d06]
- Updated dependencies [68bd0d6]
  - @n8io/baseline-queue@8.2.0

## 10.1.1

### Patch Changes

- 2ece2c7: Every Project gets a README. `pnpm app-create` renders the new `README.md` with the Project's name and description and a link to the release it was made from; it shows how to start, what runs, how to add a Domain, the commands, and where the agent docs are. A Project takes it with `pnpm template-upgrade`. The `Made from` line names the release, so it changes with every release: a Project that rewrote its `README.md` or removed that line resolves a README conflict at each upgrade by keeping its own text (docs/agents/template-upgrade.md). After `pnpm piece-remove`, drop what the README says about the piece (docs/agents/pieces.md).
- Updated dependencies [df8b85a]
- Updated dependencies [ccb666a]
- Updated dependencies [e1fafaf]
- Updated dependencies [df8b85a]
- Updated dependencies [ccb666a]
- Updated dependencies [ccb666a]
- Updated dependencies [e1fafaf]
- Updated dependencies [ede01ee]
- Updated dependencies [df8b85a]
- Updated dependencies [e1fafaf]
- Updated dependencies [ede01ee]
- Updated dependencies [e1fafaf]
- Updated dependencies [e1fafaf]
- Updated dependencies [df8b85a]
- Updated dependencies [df8b85a]
  - @n8io/baseline-analytics@2.0.1
  - @n8io/baseline-authn@6.1.1
  - @n8io/baseline-cache@6.2.1
  - @n8io/baseline-error-tracking@1.0.1
  - @n8io/baseline-health@2.0.2
  - @n8io/baseline-http@3.0.1
  - @n8io/baseline-id@3.0.1
  - @n8io/baseline-live@7.2.1
  - @n8io/baseline-logger@3.1.1
  - @n8io/baseline-postgres@5.3.1
  - @n8io/baseline-queue@8.1.1
  - @n8io/baseline-redis@1.0.1
  - @n8io/baseline-result@1.1.2
  - @n8io/baseline-shutdown@3.0.2
  - @n8io/baseline-telemetry@2.0.1

## 10.1.0

### Minor Changes

- 9b81b8a: A Project's CI runs every test nightly on main (07:17 UTC), since a pull request runs only the tests its diff reaches: the nightly run catches a test whose inputs a pull request's selection missed. It runs every job, about as many billed minutes as one pull request. Take it with `pnpm template-upgrade`; GitHub turns schedules off in a repository with no activity for 60 days.

## 10.0.0

### Major Changes

- 9032709: On a pull request, `app-ci.yml` runs only the tests its diff can reach. `ci / unit` runs `pnpm test --changed origin/<base>`: Vitest runs a test only when a file its imports reach changed, and every test when `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.node-version`, `tsconfig.json`, `.env.schema`, `.env.test` or a Vitest or Vite config changed, or when the pull request deletes a file. A new `changes` job (not a required check) reads the diff, and a pull request that changes only Markdown skips `ci / integration`, `ci / pieces` and `ci / image`; a skipped job satisfies its required check, so nothing waits. `check` and `sast` always run. A dispatched run still runs everything.

  A test that reads or runs a file of the app by its path now declares it with `import.meta.glob([...], { query: "?raw" })`, so a change to that file still runs it, or says `// Reads and runs no file of the app`. `structure.test.ts` fails on a unit test that imports `node:fs` or `node:child_process` and does neither.

  To upgrade a Project: `pnpm template-upgrade --to 10.0.0`. The ruleset keeps the same six required checks. A Project's own unit test that reads the disk needs the declaration before it passes `structure.test.ts`.

## 9.0.0

### Major Changes

- 5b9624a: The shared `app-ci.yml` runs the `migrations` and `oasdiff` checks as steps of the `check` job, so a Project's CI has six required checks instead of eight: `ci / check`, `unit`, `integration`, `pieces`, `image` and `sast`. Each job bills at least one minute and spends about 25 s on setup, while the migrations steps take about 2 s and oasdiff about 16 s, so the run bills two minutes fewer. Every step of `check` after `pnpm check` now reports even when an earlier one failed, and the job limit goes from 3 to 5 minutes.

  To upgrade a Project, in this order (the ruleset first: it only drops `ci / migrations` and `ci / oasdiff`, which the old workflow still produces, so main and open pull requests stay mergeable; a 9.x workflow under the old ruleset would wait forever for those two):
  1. With `gh` signed in as an admin of the Project's repository, from inside the Project's clone (its `origin` is the repository) and a baseline clone at 9.0.0 or later: `pnpm -C <baseline clone> app-create --github-only`. Its output includes `Updated the ci ruleset on <owner>/<repo>: changed rule required_status_checks (removed ci / migrations, ci / oasdiff)`. Like every `--github-only` run it also re-applies squash-only merging, turns on Dependabot security updates and starts one CI run on main. A Project with its own extra required checks, or a ruleset not named `ci`, removes those two contexts from its ruleset by hand instead.
  2. Right after, so that no pull request merges while migrations and oasdiff are no longer required: `pnpm template-upgrade --to 9.0.0`; it takes `.github/workflows/ci.yml` (the pin moves to `app-ci.yml@v9`) and the docs that named the old jobs.

### Minor Changes

- 96f9429: Refuse a cursor an integer column cannot hold. `CursorKind` gains `integer`: `cursorDecode` reads a cursor whose value is not a whole number from -2147483648 to 2147483647 as none, so the list shows its first page instead of a 500. `postgresKeysetCreate` takes `kind: "integer"` (an `integer` or `serial` column only) and throws a `TypeError` for a number its `integer` or `smallint` sort column cannot hold, whatever the kind. The Foo contract test pages every sort, with ties, through the new `cursorTestPagesCheck` helper.
- f035b7c: A Project lists its own files that belong to a piece in `.template.json` as `"pieceFiles": { "<piece>": ["path", ...] }`; `pnpm piece-remove` and `pnpm piece-check` delete them with the piece, and stop with a clear message on an unknown piece or a path outside the Project. Keep such paths there instead of in `scripts/piece-remove.ts`, which the Template owns: each release that changes it conflicts with lines you added. `docs/agents/pieces.md` no longer names a `context` marker in `src/server.ts`, and says where a new import goes so Biome never pulls a piece block apart.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-remove.ts`, `scripts/piece-check.ts`, their tests, and `docs/agents/pieces.md`. Move any piece paths you added to `scripts/piece-remove.ts` into `pieceFiles` in `.template.json`.

### Patch Changes

- e3df762: `authnMemoryAuthorizationCreate({ clientId, url })` returns a function that gives a script the current `Authorization` value of a memory machine client and fetches a new token before the held one expires (15 minutes), so a script that runs longer stops failing with 401s. Callers share one fetch; `{ renew: true }` refetches after a 401. `authnMemoryTokenFetch` stays for a script that ends sooner.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `docs/agents/scripts.md` and `docs/agents/authn.md`.
- ff0b8a3: Docs only. `docs/agents/dependency-updates.md` says re-running failed jobs, or one job, keeps the first attempt's `app-ci.yml` version; re-run all jobs, merge main or push a commit to get a moved `v<major>` tag. A `workflow_dispatch` run does not clear a cancelled required check.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `docs/agents/dependency-updates.md`.
- 2a01437: Docs only. `docs/agents/domain-create.md` says a seed that takes another Domain's ids must tolerate a row it seeded earlier still holding a stale one (no foreign keys between Domains; a row deleted and seeded again gets a new id). `docs/agents/api.md` says a Domain's `<domain>-error-status.ts` table is typed `as const satisfies Record<BarError["type"], number>`, not `HttpErrorStatus`, because a Domain's root imports no HTTP package.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `docs/agents/domain-create.md` and `docs/agents/api.md`.
- 37a6f5f: `pnpm piece-check` reports a failed `pnpm remove` or `pnpm add` during a piece's removal (registry error, network, store) as "could not be checked" with the command's output, instead of blaming the piece; a removal that fails on your code still blames the piece. `pnpm piece-remove` run by hand says the package manager failed and undoes the removal.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-remove.ts`, `scripts/piece-check.ts`, their tests, and `docs/agents/pieces.md`.
- Updated dependencies [e3df762]
- Updated dependencies [96f9429]
  - @n8io/baseline-authn@6.1.0
  - @n8io/baseline-postgres@5.3.0

## 8.2.0

### Minor Changes

- 0f9ae9a: The production image runs on `node:26-alpine` in both stages, at the owner's choice after a comparison of slim, Alpine and distroless (#393). The Template's full render goes from 324 MB to 254 MB, and with every piece removed it goes from 302 MB to 232 MB. On the day of the change Trivy reported 1 OS vulnerability in the Alpine base and 210 in Debian slim. Native packages now install their musl builds, and a shell in the container is BusyBox `sh`, not `bash`. `image-budget.json` drops from 360 to 280 MB.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `Dockerfile`, `dockerfile.test.ts`, `docs/agents/deploy.md` and `image-budget.json`. A Project that set its own budget gets a conflict in `image-budget.json`: keep yours, then lower it to your next `image` job's `Image: N MB` plus about 10%. A Project with a production dependency that ships only a glibc native binary keeps `node:26-slim` (keep both `FROM` lines, the test and your `image-budget.json`). Rebuild the image and run your deploy checks; a script or health check that calls `bash` inside the container needs `sh`.

### Patch Changes

- fc43eff: A Project now keeps the test that the OpenAPI document declares the bearer scheme and requires it on every operation. It moved out of the example (foo) block of `server-wiring.test.ts` into the base "security guards" block, so removing the Domain no longer removes it. The same block gains a test that a bearer request to /api passes whatever its Origin, and a test that the document is served without a token. On a template upgrade a Project gets these tests; To upgrade a Project: run `pnpm template-upgrade`; it takes `test/integration/server-wiring.test.ts`.
- a30ed95: The production image is smaller: the Dockerfile deletes source maps and type declarations (`*.map`, `*.d.ts`, `*.d.mts`, `*.d.cts`) from the production `node_modules`, which Node never reads at run time. The Template's full render went from 430 MB to 324 MB, and with every piece removed it went from 342 MB to 302 MB. `image-budget.json` drops from 430 to 360 MB, and `docs/agents/deploy.md` says how a Project sets its own.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `Dockerfile`, `dockerfile.test.ts`, `docs/agents/deploy.md` and `image-budget.json`. A Project that kept the Template's 430 gets 360. A Project that set its own budget gets a conflict in `image-budget.json`: keep yours, then lower it to your next `image` job's `Image: N MB` plus about 10%. A Project whose production dependency reads `.d.ts` or `.map` files at run time excludes that package in the Dockerfile's `find` line.
- 4fd91f4: `pnpm piece-check` now reports a failed `pnpm install` in a piece's worktree as "could not be checked", with the install's output, and never as "X can no longer be removed". Only a failing check after a good install blames the piece.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-check.ts` and `docs/agents/pieces.md`.
- f9deae9: `pnpm template-upgrade` waits for npm to serve every `@n8io/baseline-*` tarball before it installs, so an upgrade to a release published minutes ago no longer fails with `ERR_PNPM_TARBALL_HTTP_STATUS` 404. A wait that runs out names the missing tarball, says it is a registry delay, and says what to run by hand. The upgrade that brings this release in still runs your old `template-upgrade.ts`, so the wait applies from the next upgrade.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/npm-tarballs-wait.ts`, `scripts/template-upgrade.ts` and their tests, and `docs/agents/template-upgrade.md`.

## 8.1.1

### Patch Changes

- 3ab6f98: `pnpm piece-check` no longer fails when the pnpm store is empty, as in baseline's render-and-test jobs. It checks the unmodified tree first, alone, so that install fills the store, and only then checks the pieces two at a time. Before, two worktree installs could download into the empty store at once and fail with "failed to import".

  To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-check.ts` and `docs/agents/pieces.md`.

## 8.1.0

### Minor Changes

- ec468dc: The Template serves an interactive API reference at `/api/v1/docs`, and its OpenAPI document declares bearer auth.
  - The page is Swagger UI, self-hosted from `swagger-ui-dist` (the new dependency), with its script and stylesheet served from the app's own origin and the request's CSP nonce on both script tags. It answers without a token in every environment, like `/api/v1/openapi.json`; `httpSecureHeaders` is unchanged. Use Authorize with a token from the memory issuer (`authnMemoryTokenFetch`) or your provider to send requests.
  - `/api/v1/openapi.json` now has a `bearer` security scheme (`type: http`, `scheme: bearer`, `bearerFormat: JWT`) and a document-level `security` requirement, so generated clients and viewers know every operation needs a token.
  - It is the `api-reference` piece: `pnpm piece-remove api-reference` removes `src/api-reference.ts`, its tests, its block in `src/server.ts`, the dependency and the `@scarf/scarf` line in `pnpm-workspace.yaml`.

  To upgrade a Project: `pnpm template-upgrade`. To remove the page, run `pnpm piece-remove api-reference` afterwards; `/api/v1/docs` then answers the API's JSON 404. The `/api/v1/docs` exemption in the "no Actor, no API" guard stays in `server.ts`.

### Patch Changes

- 5d5a772: The shared `app-ci.yml` no longer runs a separate `glossary-check` job: the glossary alias warnings now run as a step inside `check` and still show as annotations when `check` gets that far. The `image` job skips `pnpm install` (the Dockerfile installs inside the image), and the checkout keeps no credentials in `.git`. `pnpm run ci` now also runs `pnpm piece-check`, and `AGENTS.md` lists what it covers and what only CI runs. No required check changes.
- 7c686fc: `src/connections.postgres.test.ts` gives its test 60 s, like every integration test that drops its database with `await using`: the drop forces a Postgres checkpoint, which took 6.7 s on a CI runner against Vitest's 5 s default. `structure.test.ts` now fails a file that drops its database with `await using` and has no `describe(name, { timeout: 60_000 }, ...)`.

  To upgrade a Project: run `pnpm template-upgrade`. In the Project's own Postgres tests, give any file that uses `await using database = await integrationDatabaseCreate()` the timeout: `describe("name", { timeout: 60_000 }, () => { ... })`; `pnpm test` (`structure.test.ts`) fails on one that lacks it. Files that drop in `afterAll` need nothing, because `hookTimeout` covers them.
- ba96c41: The integration budget is 4 minutes, up from 3, at the owner's request: `pnpm test:integration` runs under `timeout 4m` in `app-ci.yml`, the integration job limit is 6 minutes, and AGENTS.md `## Verify` says 4 min. A Project that copies the budget line from the Template's AGENTS.md changes `(3 min budget)` to `(4 min budget)`.
- cad7559: `pnpm piece-check` checks the pieces two at a time, each on its own throwaway worktree with a unique name, so two runs on one machine never collide. Each piece prints one result line, and a failing piece's output is printed at the end. The checks per piece and the exit code are unchanged; a broken tree still blames no piece, and neither does a check that crashes or is killed.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-check.ts`, its test and `docs/agents/pieces.md`.
- 41a9518: The shared `app-ci.yml` `sast` job now scans with a pinned snapshot of the same Semgrep packs (`p/typescript`, `p/nodejs`, `p/react`, `p/secrets`: 121 rules at one commit of semgrep/semgrep-rules) instead of downloading them from semgrep.dev on every run, so a new upstream rule can no longer fail a pull request on its own. Rule ids and `nosemgrep` suppressions are unchanged, and the findings were the same on the Template and on the known Projects. `docs/agents/dependency-updates.md` says how the pin moves. No required check changes.
- bdc6028: `server-ready.test.ts` no longer fails now and then on a busy 2-CPU runner with "timed out waiting for the exit". The test that takes PORT before the server starts waited 10 s for the exit, but the exit comes only after a whole boot, which takes 10 to 12 s there. It now allows `productionServerBootMs` (20 s), the same allowance every other boot wait in `test/integration/production-server.ts` uses, so a server that hangs instead of exiting still fails.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `test/integration/production-server.ts` and `test/integration/server-ready.test.ts`.

## 8.0.1

### Patch Changes

- 06b2061: The Project's `ci` workflow cancels a superseded run on the same ref, so a second push to a pull request stops the first run. Runs on `main` never cancel each other.
- 2d24861: Clear the moderate advisory in the built server: `react-router-hono-server` moves to 4.1.9, which brings `@hono/node-server` 2.1.6. `docs/agents/dependency-updates.md` gains a step on what to do when Dependabot ends with `security_update_not_possible`.

  To upgrade a Project: run `pnpm template-upgrade`; it takes `apps/app/package.json`, the doc and `piece-remove.ts`, and `pnpm install` refreshes your lockfile.
- 9cebb25: CI now enforces the unit (2 min) and integration (3 min) budgets on the test command itself, with a message that names the budget, and the job limits sit a little above as a backstop. The Template's integration tests run four files at a time (`maxWorkers: 4`), so a Project's integration job no longer runs close to its limit on a 2-CPU runner.

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
  1. In `src/use-cases.ts`, between the pair, paste the skeleton and move each `const <domain>UseCases = telemetryUseCasesTrace(...)` from `server.ts` into it above `// domain-create: use-cases`, in the order the Bridges need, with `<domain>UseCases,` above `// domain-create: use-cases-returned`; add the imports it needs. The skeleton is the Template's `src/use-cases.ts`: `export const domainsUseCasesCreate = (connections: Connections) => { ... }` holding the `use-cases` marker above its `return {`, the `use-cases-returned` marker as the returned object's last line, and `export type DomainsUseCases = ReturnType<typeof domainsUseCasesCreate>;` after it.

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

- a1fc77c: AGENTS.md indexes every agent doc and names every command, and a cloud agent session has a written setup.
  - `scripts/agent-setup.sh` and `docs/agents/agent-setup.md` (new): ready a fresh cloud container in one command: Node from `.node-version` through nvm, the pinned pnpm, `pnpm install --frozen-lockfile`, a running `dockerd` that pulls through `mirror.gcr.io`, and the `oasdiff` status. The page also covers a daemon that dies between turns, `IMAGE_REGISTRY`, and building the image behind a TLS proxy without committing its CA.
  - `docs/agents/planning.md` (new): ask once for a build of several Domains with an approved plan, what `domain-create` already writes, ticket size, and how parallel Domain PRs share the wiring files and migrations.
  - `docs/agents/api.md`: route conventions (command routes `POST /<things>/{id}/<verb>`, 422 for a missing referenced id, 200 for an upsert).
  - AGENTS.md: the dev URL (5173, not `PORT`), one integration file with `pnpm test:integration <path>`, `pnpm dev:reset`, `pnpm api-check`, `pnpm piece-check`, no coverage tooling, Domain tests free of module state, the two Biome naming traps in tests, where a helper two Use cases share goes, the clock rule (A26), test helpers exempt from `useMaxParams`, and Read when lines for the two new pages and `piecesKept`. It stays under 13,000 bytes.
  - A structure test fails when AGENTS.md or a `docs/agents/` page names a `pnpm` command that is no script and no pnpm command (a binary runs through `pnpm exec`), and a test checks that the render keeps AGENTS.md and every agent doc whole. `tracing.md`, `data.md`, `template-upgrade.md` and AGENTS.md no longer name the example Domain, so a Project's copy keeps every line.

  To upgrade a Project: the Template upgrade brings these files. `structure.test.ts` now fails on a `pnpm` command your own AGENTS.md lines or `docs/agents/` pages name that is no script and no pnpm command: fix the doc, and run a binary as `pnpm exec <bin>`. Keep your own AGENTS.md lines within the 14,000-byte budget.
- 81c3e17: A new Project starts with no Domain, and its first pull request adds the first one (`pnpm app-create`, from baseline's root).
  - The Template's `.github/workflows/ci.yml` also runs on `workflow_dispatch`; app-create uses it to run CI once on a new Project's main.
  - `app-ci.yml`'s `migrations` job passes a Project that has no table yet (drizzle-kit generate refuses an empty schema).
  - `CONTEXT.md`'s Foo entry no longer says app-create replaces Foo.
  - baseline's `app-create` drops `--domain`, `--plural` and `--definition`, warns when main holds changesets the newest release does not, waits for npm to serve the release's `@n8io/baseline-*` versions before it installs, and gains `--no-github` (render and commit only) and `--github-only` (the repo, ruleset, Dependabot settings and first CI run, inside an existing render). docs/agents/project-create.md walks through both, and the path for a cloud agent session.

  To upgrade a Project: the Template upgrade brings the `workflow_dispatch` trigger; nothing to apply by hand.
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
- 5e15724: `pnpm piece-check` runs `pnpm check` and `pnpm test` on the unmodified tree first and stops with "fix the tree first" when they fail, so a failing test no longer blames every piece. `pnpm template-upgrade` renders both releases with the Project's removed pieces already removed (their package, files, blocks and env lines), so a removed piece no longer comes back as a conflict.
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
- 48e12c3: Three small checks the DX fixes left open, and two rough edges.
  - Rule A14 now sees another Domain's id in a plain `uuid("proposer_team_id")` column (the shape `data.md` tells people to use) and in a column helper hoisted into a sibling `spi/` file, so the `<other>.deleted` Consumer can no longer be forgotten. A Project whose table stores another Domain's id without that Consumer fails `pnpm test` after upgrading: add the Consumer.
  - `glossary-check` reads JSX text in `.tsx` files: single-line text between a tag's `>` and the next `<` or `{`, without parentheses, `;`, `=`, `|` or `&`. Text after a `{...}`, after a multi-line opening tag or after a self-closing tag is still not read. Two Foo comments no longer use the aliases "integration" and "transport", so a Project's first Domain PR is not warned.
  - `app-ci.yml` runs `shellcheck` on every `*.sh` in the `check` job.
  - A Server or Worker that cannot open a connection at boot logs one structured fatal line and exits 1, instead of a raw `pg-pool` stack.
  - Running one `*.postgres.test.ts` no longer asks for `pnpm build`: the stale-build check moved to the integration helper that starts the Server.
  - `pnpm domain-create` counts `redis` as a removable piece, so a Project without `@n8io/baseline-redis` gets no Redis lines in a new Domain.
- e2db23c: The Template's tests use no mocks, spies or fake timers, so a Project copies none. The baseline repository's `test/no-mocks.test.ts` fails on any `vi.*` call (except `vi.waitFor` and `vi.waitUntil`) or `vi` import anywhere under `apps/app`. What changed: `src/server-wiring.test.ts`, `src/server-seed.test.ts` and `src/server-hmr.test.ts` are gone. The server wiring checks (`test/integration/server-wiring.test.ts`, now run by `pnpm test:integration`, which needs Docker and a build) and the Server's seeding check (`test/integration/foo-server-seed.test.ts`) now drive the production build over HTTP; the dev server's close order lives in `src/ui/server-dev-close.ts` with its own test; `error-tracking-open.test.ts` reports to a local Sentry-shaped server; `asset-reload-listen.test.ts` runs the function with plain-object stand-ins; `envMemoryRefused` (in `src/env.ts`) and `databaseOpen({ poolMax })` take their input instead of reading `ENV`; `templateUpgradeRun` takes an optional `output`.

  To upgrade a Project: delete those three test files if the upgrade reports a conflict, and move any case you added to `src/server-wiring.test.ts` into `test/integration/server-wiring.test.ts`. Apply the `databaseOpen` and `envMemoryRefused` changes by hand if you changed those files.
- 5204132: Two Projects on one machine run `pnpm dev` and `pnpm run ci` at the same time.
  - A Project's port block from its name now holds seven ports: the four compose.yaml publishes, then the dev Server's `PORT` and `HEALTH_PORT` (new lines in `.env.development`) and the dev Worker's health port in the `dev` script. The Template keeps 3000, 9000 and 9001; production's `PORT` and `HEALTH_PORT` in `.env.schema` do not change.
  - Integration tests claim the ports for the Servers and Workers they boot from 30000 to 31383 (`test/integration/integration-port-claimer.ts`): a claim is a socket the run keeps listening on the port's guard, 1384 ports above it, so the OS gives each port to one run and frees it when that run exits. Each Project's run used to take the same `20000 + VITEST_POOL_ID * 100` block, so two runs could both start a child on one port and a test could reach the other Project's Server.

  To upgrade a Project: `pnpm template-upgrade` renders both releases with your Project's name, so it adds the `.env.development` lines and your own Worker port to the `dev` script. A Project that changed its `dev` script, e.g. by removing the queue or ui piece, gets a conflict there: keep your script and change its `HEALTH_PORT=9001` to the one the new side shows.

### Patch Changes

- c0d7cf7: `docs/agents/events.md` covers what an agent had to guess about Events: where per-key order stops (a Consumer that needs another key's row creates it on demand, a redriven dead Event runs late, a version guard for stale Events), Consumers that write a shared Aggregate (lock the root, in id order), fan-out in a Consumer (one lock order, chunks under the bind-parameter limit, several transactions before the 5 s limit), a column holding another Domain's id ships with its `deleted` Consumer (rule A14) and the repository side of that clean-up, testing a Consumer with `queueTestConsumerRun`, when one release is enough to change an Event's shape and what must be drained before you narrow, and naming for analytics and live channels beside Events.

  To upgrade a Project: take `docs/agents/events.md` from the Template.
- 0831d8b: `domain-create` works in a Project made from app@8, and its CI pin follows the Template.
  - `domain-create` no longer treats a Markdown file as a wiring target. The Template's `CHANGELOG.md` quotes marker lines in its upgrade notes, so without this every `pnpm domain-create` in a Project would stop with "CHANGELOG.md is missing; the template wires domains there".
  - `.github/workflows/ci.yml` calls `app-ci.yml` and `dependabot-automerge.yml` at the Template's own major (`@v8` for app@8), and `pnpm run version` moves that pin with every Template major, so a Project never runs an older CI than its Template expects.

  To upgrade a Project: `pnpm template-upgrade` moves `ci.yml` to `@v8`, which brings the required `pieces` job and the stricter `migrations` check; run `pnpm piece-check` before you push the upgrade.
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
