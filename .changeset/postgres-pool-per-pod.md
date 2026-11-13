---
"@n8io/baseline-postgres": minor
"app": minor
---

Postgres holds up with many processes on one database.

- `postgresPoolCreate` takes `queryTimeoutMs` (default 15 s, `null` for no limit): a query that runs longer rejects and its connection is closed. The server may still finish it. Idle connections are probed after 10 s. A Project with a query that needs longer than 15 s outside `postgresMigrate` sets `queryTimeoutMs` in `src/connections.ts`.
- `postgresMigrate` waits at most `lockWaitMs` (default 60 s) for its lock and then fails with an error that names the lock. It refuses to run through a connection pooler such as PgBouncer, where the lock would outlive the run and block the next one.
- Template: `DATABASE_POOL_MAX` sets the most Postgres connections one process opens; without it the Server opens up to 10 and the Worker up to 5 (it was 10). `DATABASE_MIGRATE_URL` points migrate at Postgres itself where `DATABASE_URL` goes through a pooler.
