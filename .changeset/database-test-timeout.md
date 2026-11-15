---
"app": patch
---

`src/connections.postgres.test.ts` gives its test 60 s, like every integration test that drops its database with `await using`: the drop forces a Postgres checkpoint, which took 6.7 s on a CI runner against Vitest's 5 s default. `structure.test.ts` now fails a file that drops its database with `await using` and has no `describe(name, { timeout: 60_000 }, ...)`.

To upgrade a Project: run `pnpm template-upgrade`. In the Project's own Postgres tests, give any file that uses `await using database = await integrationDatabaseCreate()` the timeout: `describe("name", { timeout: 60_000 }, () => { ... })`; `pnpm test` (`structure.test.ts`) fails on one that lacks it. Files that drop in `afterAll` need nothing, because `hookTimeout` covers them.
