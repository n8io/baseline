# Data rules

Read when touching a table, a migration or SQL.

- Postgres 17 or newer.
- Drizzle stays on the pinned 1.0 rc until 1.0 GA, because the `migrations/<ts>_<name>/` folder format needs 1.x. Move to GA when it ships.
- Change schemas with expand then contract. A rename is an added column in one release and a dropped one in a later release.
- Run `pnpm codegen` after editing a table file, and before running a new table's Postgres tests (they migrate from `migrations/`). Name the migration with `pnpm codegen --name <slug>`. A PR may only add folders under `migrations/`.
- Split drops and adds into two migrations: add in one, drop (with its `destructive.md`) in a later one.
- On a migration conflict, delete your migration, rebase and run `pnpm codegen` again. Never use `--fix-conflicts` or `--hints`.
- Destructive SQL (`DROP`, `RENAME`, `ALTER COLUMN ... TYPE`, `SET NOT NULL`) needs a `destructive.md`. Adding one is a stop-and-ask. The file is `migrations/<folder>/destructive.md` and says why the change is safe now; the `migrations` CI job fails a new `migration.sql` with `DROP TABLE`, `COLUMN`, `SCHEMA`, `INDEX`, `CONSTRAINT`, `TYPE`, `VIEW` or `SEQUENCE`, `RENAME`, `ALTER COLUMN ... TYPE` or `SET NOT NULL` and no such file.
- Tables hold UUIDs; code and the API speak prefixed ids (`foo_…`). `postgresIdColumnCreate("foo")` converts at the column; in raw values use `idToUuid` and `idFromUuid` from `@n8io/baseline-id`.
- No foreign keys across Domains. Store another Domain's id as a plain indexed `uuid` column.
- Do not use `sql.raw` in `spi/`.

## Locking and limits

A transaction alone does not stop a lost write: two transactions can read the same row, and the later write undoes the earlier one. Under Postgres's READ COMMITTED:

- Read a row you will write back through the repository's `findByIdForUpdate` (Drizzle `.for("update")`) inside the transaction, as `fooUpdate` and `fooDelete` do. A concurrent write then waits until you commit. Lock several rows in id order (`.orderBy(asc(table.id)).for("update")`), so two transactions cannot deadlock.
- A limit across rows (at most N per owner) has no row to lock: take `postgresAdvisoryLockTake(db, "<domain>:<owner id>")` first, then count and insert.
- Change a counter with one statement (``set({ count: sql`${table.count} + 1` })``), never read, add and write back.
- A write that finds its row gone (deleted since the read) returns the Domain's NotFound error, never throws: the route answers 404, not 500.
- Postgres takes at most 65,535 bind parameters per statement: chunk a fan-out insert (rows × columns) under it.
- A race test forces the interleaving with `postgresTestInterleave` from `@n8io/baseline-postgres/testing` and fails with the lock removed; check that before you merge (`foo-update.postgres.test.ts`).

## An Aggregate with a child table

When an Aggregate owns a list (a team's roster), keep both tables in the Domain's one `spi/<domain>-table.ts`. The root repository loads and saves the whole Aggregate: `findById` reads the root row and its child rows, `update` writes the root and replaces or diffs the children in the same transaction, and no other port touches the child table. The memory adapter stores the Aggregate as one value, and the shared repository tests (`spi/<domain>-repository.contract.ts`) check that the children round-trip on both adapters.
