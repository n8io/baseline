---
"@n8io/baseline-postgres": minor
---

Add the helpers a Domain with more than CRUD kept writing by hand:

- `postgresKeysetCreate({ after?, descending, idColumn, kind, sortColumn })` builds keyset paging's `where` and `orderBy` for a `text` (byte order), `number` or `date` sort, with the id as tie-breaker. A cursor value of the wrong type for `kind`, or a date that is not an ISO instant, throws a `TypeError`.
- `postgresAdvisoryLockTake(db, key)` takes a transaction-scoped advisory lock on a string key.
- `postgresUniqueViolationRead(error)` returns the violated constraint with its columns and values; `postgresUniqueViolationIs` stays.
- A new `@n8io/baseline-postgres/testing` entry exports `postgresTestInterleave({ first, second, pgPool, timeoutMs? })`, which forces the interleaving a race test needs and reports whether the second transaction waited on a lock.
