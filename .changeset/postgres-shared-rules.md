---
"@n8io/baseline-postgres": minor
---

Postgres follows the shared Package rules: `PostgresMigrateOptions` and `PostgresTransactionRunOptions` are exported; `postgresPoolCreate`'s `connectTimeoutMs`, `max` and `vendor` and `postgresMigrate`'s `vendor` also take `null` for their default (`queryTimeoutMs: null` still turns the limit off, as its doc says); `postgresPoolCreate` refuses a `max` or `connectTimeoutMs` that is not a positive integer; and each bad-option `TypeError` message starts with the function's name (`postgresPoolCreate: max must be a positive integer`). The option checks moved to tests that run without Docker (`pnpm test:unit`).
