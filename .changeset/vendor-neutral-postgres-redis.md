---
"@n8io/baseline-postgres": minor
"@n8io/baseline-redis": minor
---

`@n8io/baseline-redis`: `RedisClient` is now a Package-owned type, `RedisConnection` plus `AsyncDisposable`, that lists only the commands the cache store and the live hub send and the lifecycle calls; it is no longer node-redis's `RedisClientType`. Code that ran another command on it (`ping`, `clientList`) moves to an adapter that builds its own client. `RedisClientVendorOptions` is no longer exported; write the `vendor` object inline in `src/redis-open.ts`.

`@n8io/baseline-postgres`: `PostgresPoolVendorOptions` and `PostgresMigrateVendorOptions` are no longer exported; write the `vendor` object inline in `src/connections.ts` and `src/migrate.ts`, or take `NonNullable<PostgresPoolOptions["vendor"]>`. `PostgresPool` and `PostgresClient` still are pg's types, because Drizzle's `drizzle({ client })` takes only those.
