# @n8io/baseline-postgres

Postgres on [pg](https://node-postgres.com) and [Drizzle](https://orm.drizzle.team): one pool, Result-aware transactions, migrations under a lock, columns that store prefixed ids as `uuid`, keyset paging, advisory locks, and a helper that forces the interleaving a race test needs.

```sh
pnpm add @n8io/baseline-postgres
```

## Exports

- `postgresPoolCreate({ databaseUrl, max?, connectTimeoutMs?, queryTimeoutMs?, vendor? })`: the process's one pool (10 connections, 3 s connect timeout). A query that takes longer than `queryTimeoutMs` (default 15 s, `null` for no limit) rejects with `Query read timeout`, so a server that stops answering cannot hold a request or a pool slot forever. The pool closes that connection; inside `postgresTransactionRun` it is closed once the rollback has been tried, which can take one more `queryTimeoutMs`. The timer runs in this process and sends no cancel: a server that is slow, not gone, may still finish the query, a write included, so treat the rejection as "unknown", not "did not happen". The limit is per query, inside a transaction too. An idle connection is probed after 10 s (TCP keep-alive). `vendor` takes pg's own pool settings, such as `ssl` or `idleTimeoutMillis`, and passes them through. The named options win: `vendor` throws on the keys they set, on `host`, `port`, `database`, `user` and `password` (pg lets the URL win, so put them in `databaseUrl`), and on `ssl` when the URL carries an `ssl*` parameter. It is outside the contract: nothing in it is tested here, and moving off pg deletes it.
- `PostgresPool`, `PostgresClient`: the pool and a checked-out connection. `await using` calls the pool's `end()` when its block ends. Name these in your own signatures, not `pg`'s types. They are pg's own pool and client, because Drizzle's `drizzle({ client })` needs the real ones.
- `postgresTransactionRun({ pgPool, work, timeoutMs? })`: runs `work(pgClient)` in one transaction; COMMIT on `ok`, ROLLBACK on `err` or a throw. It ends after `timeoutMs` (default 5 s).
- `postgresMigrate({ databaseUrl, migrationsFolder, lockWaitMs?, vendor? })`: applies pending Drizzle migrations under an advisory lock, so concurrent starts apply each one once. A run waits up to `lockWaitMs` (default 60 s) for the lock, then fails with an error that names it. The lock belongs to the session, so `databaseUrl` must reach Postgres itself: through a connection pooler such as PgBouncer the run refuses before it changes anything. Queries here have no time limit. `vendor` takes pg's settings for its one connection, under the same rules as the pool's.
- `@n8io/baseline-postgres/testing`: `postgresTestInterleave` for race tests (below). Import it from tests only.
- `postgresIdColumnCreate(prefix)`: a Drizzle `uuid` column that reads and writes `Id<prefix>`.
- `postgresUniqueViolationIs(error, constraint)`: true when a unique violation on that constraint is anywhere in the `cause` chain.
- `postgresUniqueViolationRead(error)`: the first unique violation in the `cause` chain as `{ constraint, columns, values }`, or `undefined`. `columns` and `values` come from Postgres's detail (`Key (league_id, name)=(7, Eagles)`), so a value is text as Postgres printed it. Postgres quotes nothing there, so when a key of two or more columns holds a value with `", "` in it, both lists are empty rather than misaligned; an expression key such as `lower(name)` comes back as Postgres printed it, and one with `", "` inside may not split cleanly. Read `constraint` when you need certainty.
- `postgresKeysetCreate({ after?, descending, idColumn, kind, sortColumn })`: keyset paging on `(sortColumn, idColumn)`. Returns `{ where, orderBy }` for a Drizzle `select`; `where` is `undefined` on the first page. `after` is the last row of the previous page, `{ id, value }`, with `id` written through `idColumn` (a prefixed id works). `kind` says how the sort compares: `text` by byte order (`COLLATE "C"`, the same in every locale, so give the column a `COLLATE "C"` index); `number` as the column's own type, so its index is used (for `integer`, `real` and `double precision` columns; a `numeric` or `bigint` column reads as a string or a bigint and is not supported); `date` as an instant, with `value` an ISO string with an offset (`toISOString()`). The sort column must be `NOT NULL`, because a NULL never compares, and a `date` column must hold no more than milliseconds (`timestamp({ precision: 3, withTimezone: true })`, or written only from a JS `Date`): a cursor made from a `Date` drops the microseconds a `now()` default stores, and pages would repeat or skip rows. A `value` of the wrong type for `kind`, or a date that is not an ISO instant, throws a `TypeError`: decode and check a cursor before you pass it.
- `postgresAdvisoryLockTake(db, key)`: waits for and takes a transaction-scoped advisory lock on the string `key`; Postgres drops it at COMMIT or ROLLBACK. Use it to serialize work that has no row to lock, such as counting a League's Teams before inserting one. `db` is anything with Drizzle's `execute` (`PostgresExecutor`). Call it inside `postgresTransactionRun`: outside a transaction the lock ends with the statement.

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

const result = await postgresTransactionRun({
	pgPool,
	work: async (pgClient) => {
		const rows = await drizzle({ client: pgClient })
			.insert(fooTable)
			.values(foo)
			.returning();
		return rows[0] ? ok(rows[0]) : err({ type: "FooNotCreated" as const });
	},
});
```

## Keyset paging

```ts
import { postgresKeysetCreate } from "@n8io/baseline-postgres";

const keyset = postgresKeysetCreate({
	after: cursor ? { id: cursor.id, value: cursor.value } : null,
	descending: true,
	idColumn: fooTable.id,
	kind: "date",
	sortColumn: fooTable.createdAt,
});
const rows = await db
	.select()
	.from(fooTable)
	.where(and(isNull(fooTable.archivedAt), keyset.where))
	.orderBy(...keyset.orderBy)
	.limit(limit + 1);
const page = rows.slice(0, limit);
const last = page.at(-1);
const nextCursor =
	rows.length > limit && last
		? { id: last.id, value: last.createdAt.toISOString() }
		: null;
```

## Advisory locks

```ts
import { postgresAdvisoryLockTake } from "@n8io/baseline-postgres";

// In a transaction: two Team creates in one League count one after the other.
await postgresAdvisoryLockTake(db, `team-count:${leagueId}`);
const [counted] = await db
	.select({ total: count() })
	.from(teamTable)
	.where(eq(teamTable.leagueId, leagueId));
```

## Race tests

`@n8io/baseline-postgres/testing` exports `postgresTestInterleave({ first, second, pgPool, timeoutMs? })`, for tests only. `first(pause)` runs until it awaits `pause()`, typically right after it read and locked what it will write. Then `second()` starts, and `first` resumes once `second` waits on a lock (`pg_stat_activity`) or has finished. It returns `{ first, second, secondWaited }`; `secondWaited` is false when no lock made `second` wait. It fails when `first` never pauses, or when `second` neither waits nor finishes within `timeoutMs` (default 5 s). A connection that already waited on a lock before `second` started does not count; any other one in the same database does, so keep other work off that database while it runs. It needs three connections from `pgPool` at once: `first`'s, `second`'s, and one to watch `pg_stat_activity`.

```ts
import { postgresTestInterleave } from "@n8io/baseline-postgres/testing";

// Reads a count, then writes it back plus one: a read-modify-write Use case.
const increment = (pause?: () => Promise<void>) =>
	postgresTransactionRun({
		pgPool,
		work: async (pgClient) => {
			const db = drizzle({ client: pgClient });
			const [row] = await db
				.select()
				.from(counterTable)
				.where(eq(counterTable.id, id))
				.for("update"); // remove it and the test below must fail
			await pause?.();
			await db
				.update(counterTable)
				.set({ n: (row?.n ?? 0) + 1 })
				.where(eq(counterTable.id, id));
			return ok(undefined);
		},
	});

const result = await postgresTestInterleave({
	first: (pause) => increment(pause),
	pgPool,
	second: () => increment(),
});
expect(result.secondWaited).toBe(true);
```

A race test must fail with the lock removed. Before you trust one, take the lock out (`FOR UPDATE`, the advisory lock), see the test go red for the right reason, and put it back. A plain `Promise.all` of two writes usually passes either way, because one finishes before the other starts.

## Needs

- Peers: `pg`, `drizzle-orm` (`1.0.0-rc.5`, pinned until 1.0 is out) and, for types, `@types/pg`.
- Env, by the template's convention: `DATABASE_URL` (`postgres://` or `postgresql://`), `DATABASE_POOL_MAX` for `max`, and `DATABASE_MIGRATE_URL` for `postgresMigrate` where `DATABASE_URL` goes through a pooler. Transactions use `transaction_timeout`, so Postgres 17 or newer.

## Sizing the pool

Every process opens up to `max` connections, and Postgres refuses new ones past its `max_connections`. Keep the sum over every process (`max` times the number of processes, counting the extra ones a rollout starts) under that limit, with a few left for migrate and for people. Behind a pooler, keep it under the pooler's limit instead.

## Tests

`pnpm test` needs Docker: it starts a Postgres container and, for the migrate tests, PgBouncer.
