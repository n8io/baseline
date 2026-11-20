---
"@n8io/baseline-postgres": minor
---

`PostgresMigrateOptions` takes `connectTimeoutMs` (default 3000), so the refusal of `vendor.connectionTimeoutMillis` now points at an option that exists. postgresPoolCreate, postgresMigrate and postgresTransactionRun refuse a duration above 2147483647, postgresKeysetCreate refuses an unknown `kind`, and every bad-option message ends `found X`. The id column error reads `postgresIdColumnCreate: value must be a <prefix> id`. Each options field has a doc comment.
