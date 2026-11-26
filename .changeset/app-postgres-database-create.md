---
"app": patch
---

The Foo context builds its Drizzle databases with `postgresDatabaseCreate` and types its repositories with `PostgresDatabase`, since `PostgresPool` and `PostgresClient` no longer are pg's types.
