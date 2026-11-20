---
"app": major
---

The Template's code follows its own naming and testing rules more closely.

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
