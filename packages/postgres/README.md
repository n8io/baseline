# @n8io/baseline-postgres

Postgres on [pg](https://node-postgres.com) and [Drizzle](https://orm.drizzle.team): one pool, Result-aware transactions, migrations under a lock, and columns that store prefixed ids as `uuid`.

```sh
pnpm add @n8io/baseline-postgres
```

## Exports

- `postgresPoolCreate({ databaseUrl, ...pg.PoolConfig })`: the process's one pool (10 connections, 3 s connect timeout).
- `postgresTransactionRun(pgPool, work, { timeoutMs? })`: runs `work(pgClient)` in one transaction; COMMIT on `ok`, ROLLBACK on `err` or a throw. It ends after `timeoutMs` (default 5 s).
- `postgresPortsGuard(ports, isOpen)`: wraps a transaction's ports so a call after the transaction ended throws.
- `postgresMigrate({ databaseUrl, migrationsFolder })`: applies pending Drizzle migrations under an advisory lock, so concurrent starts apply each one once.
- `postgresIdColumnCreate(prefix)`: a Drizzle `uuid` column that reads and writes `Id<prefix>`.
- `postgresCursorEncode(cursor)`, `postgresCursorDecode(text, prefix)`, `PostgresCursor`: a list page's position as base64url; a cursor that does not decode reads as none.
- `postgresUniqueViolationIs(error, constraint)`: true when a unique violation on that constraint is anywhere in the `cause` chain.

## Example

```ts
import {
	postgresIdColumnCreate,
	postgresPoolCreate,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import { err, ok } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, text } from "drizzle-orm/pg-core";

export const fooTable = pgTable("foo", {
	id: postgresIdColumnCreate("foo")().primaryKey(),
	name: text().notNull(),
});

const pgPool = postgresPoolCreate({ databaseUrl: ENV.DATABASE_URL });

const result = await postgresTransactionRun(pgPool, async (pgClient) => {
	const rows = await drizzle({ client: pgClient })
		.insert(fooTable)
		.values(foo)
		.returning();
	return rows[0] ? ok(rows[0]) : err({ type: "FooNotCreated" as const });
});
```

## Needs

- Peers: `pg`, `drizzle-orm` (`1.0.0-rc.5`, pinned until 1.0 is out) and, for types, `@types/pg`.
- Env, by the template's convention: `DATABASE_URL` (`postgres://` or `postgresql://`). Transactions use `transaction_timeout`, so Postgres 17 or newer.

## Tests

`pnpm test` needs Docker: it starts a Postgres container.
