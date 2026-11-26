---
"@n8io/baseline-postgres": minor
---

`postgresTransactionRun` takes any `pgPool` with `connect()` that returns a `PostgresClient`, named `PostgresTransactionRunPool`, instead of requiring a full `PostgresPool`. A `PostgresPool` still fits.
