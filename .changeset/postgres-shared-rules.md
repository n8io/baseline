---
"@n8io/baseline-postgres": minor
---

Postgres follows the shared Package rules: `PostgresMigrateOptions` and `PostgresTransactionRunOptions` are exported; `postgresPoolCreate`'s `connectTimeoutMs`, `max` and `vendor` and `postgresMigrate`'s `vendor` also take `null` for their default (`queryTimeoutMs: null` still turns the limit off, as its doc says); `postgresPoolCreate` refuses a `max` or `connectTimeoutMs` that is not a positive integer (`connectTimeoutMs: 0`, which pg read as no limit, now throws); and each bad-option `TypeError` message starts with the function's name (`postgresPoolCreate: max must be a positive integer`, `postgresKeysetCreate: after.value: …`), and a `databaseUrl` that does not parse throws `<function>: databaseUrl is not a valid URL` without echoing it. The option checks moved to tests that run without Docker (`pnpm test:unit`).
