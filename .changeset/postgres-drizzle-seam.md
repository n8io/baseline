---
"@n8io/baseline-postgres": major
---

`PostgresPool` and `PostgresClient` are no longer pg's `Pool` and `PoolClient`. `PostgresClient` is a Package-owned type with `query(text, values?)`; `PostgresPool` adds `connect()`, `end()` and `[Symbol.asyncDispose]`. Code that read the driver's own state (`options`, `idleCount`, `emit`) or called other pg methods on them moves to an adapter that builds its own pool. `postgresTransactionRun`'s `work` receives a `PostgresClient`, and `PostgresTransactionRunPool.connect()` returns the new `PostgresTransactionRunConnection`.

New: `postgresDatabaseCreate(pgClient)` returns a Drizzle `PostgresDatabase` on a pool or a transaction's client. Replace `drizzle({ client: pgPool })` and `drizzle({ client: pgClient })` from `drizzle-orm/node-postgres` with it, and `NodePgDatabase` in signatures with `PostgresDatabase`. The `vendor` option keys are unchanged.
