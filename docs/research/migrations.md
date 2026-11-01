# Drizzle 1.0.0-rc.5 migrations on Postgres 18

Setup: drizzle-orm and drizzle-kit `1.0.0-rc.5` (pinned), pg 8.23.1, Postgres 18.6 (docker, `postgres:18-alpine`, aarch64), Node 26.5.0 (26.10.0 was not installed). Test code is in `docs/research/migrations-lab/` (`scenario.sh` builds the branch-merge cases; `t3/` has the migrator tests; `t4/` has the timing test and a production-style install with no drizzle-kit). Tags: [tested] I ran it, [source] read in the installed package or the official docs, [inferred] reasoned from the above.

## Short answer

1. `pgSchema("foo")` works. `generate` writes `CREATE SCHEMA`, schema-qualified tables, and a cross-schema FK. `schemaFilter` does not affect `generate` at all.
2. Two branches that touch different tables or different columns merge cleanly in git, and `check`, `generate` and `migrate` accept the result. rc.5 does have a conflict check (the "commutativity" check). It stops on same-column and same-table-create conflicts. It writes a merge migration only on the next `generate` that has a real schema change.
3. The bookkeeping table is `drizzle.__drizzle_migrations`. It is configurable. All pending migrations run in one transaction. There is no advisory lock: two concurrent `migrate()` calls on an empty database make one succeed and one throw. An older folder added later is applied.
4. `drizzle-orm` alone can migrate from the folder at runtime. Five small migrations on an empty database take about 38 ms. `CREATE DATABASE ... TEMPLATE` takes about 8 ms. Migrating per test file is cheap.
5. `generate` does not warn about drops. It prompts for renames only when stdin is a TTY. Without a TTY it exits 2 with a `missing_hints` report. The non-interactive way is `--hints` / `--hints-file` (and `--output json`).
6. `check` in 1.0 is the commutativity check on the migration history. It does not compare against a database.

## Checks

| # | Check | Result | Tag |
|---|---|---|---|
| 1a | Two `pgSchema` files (`foo`, `bar`) with `generate` | One migration: `CREATE SCHEMA "bar"; CREATE SCHEMA "foo"; CREATE TABLE "bar"."bar" ...; CREATE TABLE "foo"."foo" ...;` then the FK. Schemas are created first, the FK last, so the order is valid. | [tested] |
| 1b | FK from `bar.bar` to `foo.foo` | `ALTER TABLE "bar"."bar" ADD CONSTRAINT "bar_foo_id_foo_id_fkey" FOREIGN KEY ("foo_id") REFERENCES "foo"."foo"("id");`. The FK is a separate statement after both tables, so file order between domains does not matter. | [tested] |
| 1c | `schemaFilter` | Read only by the `push` and `pull` config code (`preparePushConfig`, `preparePullConfig`). `generate` does not read it and needs no database connection. The JSDoc in `drizzle-kit/index.mjs` still says "default public"; that text is stale. I did not test `push` or `pull` against a database with extra schemas. | [source] |
| 1d | `drizzle` bookkeeping schema vs app schemas | The migrator puts its table in schema `drizzle` (see 3a). A domain schema named `drizzle` would collide, so pick other names. | [inferred] |
| 2a | Folder layout | `drizzle/<YYYYMMDDHHMMSS>_<name>/migration.sql` and `snapshot.json`. No journal. First snapshot is `type: base` (full schema); later ones are `type: diff` (deltas) with `id`, `prevIds` and per-statement `footprints`. Snapshot format is version 9. | [tested] |
| 2b | Branch A adds table `c`, branch B adds a column to `b`, same base, git merge | Git merges with no conflict (different files). `check` returns `{"status":"ok"}`. `generate` says no changes and writes nothing. `migrate` applied all migrations. | [tested] |
| 2c | Next `generate` after 2b with a new change (add column to `a`) | Writes a merge migration: `ALTER TABLE "a" ADD COLUMN "age" text;` only. Its `snapshot.json` has two `prevIds` (both branch leaves). The diff is correct, not spurious. Until then the branches stay "open", which does not block `migrate`. | [tested] |
| 2d | Both branches add the same column `age` | `check`, `generate`, `generate --explain` all exit 1 with `check_error`, `kind: "conflicts"`, naming both migrations. Same when types differ (text vs integer). | [tested] |
| 2e | Both branches create table `c` | Conflict, same report. | [tested] |
| 2f | One branch drops column `other`, the other alters its type | Conflict (`drop_column` vs `alter_column`). | [tested] |
| 2g | Different columns of the same table (`x` vs `y`) | No conflict. Merged schema file gives `no_changes`; adding a third column later yields only that column. | [tested] |
| 2h | `drizzle-kit migrate` with conflicting branches | Stops with the conflict report before touching the database (no `ops` schema was created). | [tested] |
| 2i | `generate --fix-conflicts` | Deletes the conflicting migrations (and their children) and writes one new migration from the current schema. Result for 2e: the two `c` migrations were deleted and one migration with `CREATE TABLE "c"` was written. Unsafe if any shared database already ran a deleted migration. | [tested] |
| 2j | Mechanism | The check builds a graph from `prevIds`, finds fork points, and compares each statement's footprint (what it reads and writes) across branches. It also counts changes that a branch later reverts. The same idempotent statement on both branches (for example `SET NOT NULL`) is not a conflict. `--ignore-conflicts` is rejected for Postgres. | [source] |
| 2k | Git conflict in the schema `.ts` when both branches edit the same line | `check` still returns ok with a `not_compared` warning (exit 0); `generate` fails with `ParseError`. So `check` does not fail on an unparseable schema. | [tested] |
| 2l | Folder order | The migrator sorts by folder name. For Postgres, `generate` bumps the new folder's time to parent plus 1 s if the clock is behind. A merge migration sorts after its parents. | [source] |
| 3a | Bookkeeping table | `drizzle.__drizzle_migrations` with columns `id serial, hash text, created_at bigint, name text, applied_at timestamptz`. The schema and table are created with `IF NOT EXISTS` on every run. | [tested] [source] |
| 3b | Configuration | ORM: `migrate(db, { migrationsFolder, migrationsSchema, migrationsTable })`. Tested `migrationsSchema: "ops", migrationsTable: "my_migs"`. Kit: `defineConfig({ migrations: { schema, table } })`; `drizzle-kit migrate` with `ops.migs` created that table. The option names differ between the two (`migrationsSchema` vs `schema`). | [tested] |
| 3c | Transactions | All pending migrations run in one `db.transaction`, each statement then the bookkeeping insert. A migration with a bad statement as the last of three rolled back everything: 0 rows, 0 tables. The schema and the empty bookkeeping table stay. Statements that cannot run in a transaction (`CREATE INDEX CONCURRENTLY`) therefore fail. | [tested] [inferred] |
| 3d | Locking | No advisory lock or `LOCK` in the migrator code (searched `pg-core/async/session.js`, `node-postgres`, `up-migrations`). | [source] |
| 3e | Two concurrent `migrate()` calls, empty database, 5 rounds | Every round: one `ok`, one error (`duplicate key value violates unique constraint "pg_namespace_nspname_index"`, once `pg_type_typname_nsp_index`). Final state correct: 5 bookkeeping rows, 5 tables. | [tested] |
| 3f | Two concurrent calls, bookkeeping table already exists, 4 migrations pending, 3 rounds | Same: one `ok`, one `duplicate key ... pg_type_typname_nsp_index`. Final state correct. So concurrent runs are safe for data but the loser throws. A deploy must run `migrate()` from one place, or the app must wrap it in its own lock (`pg_advisory_lock`) or tolerate the error. | [tested] |
| 3g | Out-of-order migration | Applied t1, t3, t4, t5, then added older t2 and ran `migrate()`: t2 was applied (bookkeeping id 5 with the oldest `created_at`). The migrator matches by full folder name, not by last timestamp. The 0.x behavior (skip anything older than the last applied) is gone. Docs say the same. | [tested] [source] |
| 3h | Applied migration deleted locally | `migrate()` returns ok; no error or warning. | [tested] |
| 4a | `drizzle-orm` only, no kit | `t4/` installed with `pnpm install --prod`: only `drizzle-orm` and `pg`, no `.bin`. `migrate()` from `./drizzle` worked. The migrator reads `<folder>/*/migration.sql` with `fs`, so the folder must be copied into the production image. It reads `snapshot.json` never. It throws if `meta/_journal.json` exists (old format). | [tested] [source] |
| 4b | Time: `migrate()`, 5 migrations (table + index each), empty DB, includes new Pool and connect | min 31, median 38, max 48 ms (n=10). | [tested] |
| 4c | Time: `CREATE DATABASE` empty | min 8, median 9, max 17 ms. Create plus migrate: median 46 ms. | [tested] |
| 4d | Time: `migrate()` with nothing pending | median 16 ms. | [tested] |
| 4e | Time: `CREATE DATABASE x TEMPLATE migrated_db` | min 8, median 8, max 13 ms. `DROP DATABASE ... WITH (FORCE)` about 2 ms. The template needs zero open connections (the pool was closed). So a template saves about 30 ms per file for this size; the schema would need to be much bigger for it to matter. Numbers are from Docker on a Mac, 5 tiny tables; larger schemas will take longer. | [tested] |
| 5a | `generate` with a dropped column and a dropped table, no TTY | No warning, no prompt, exit 0: `DROP TABLE "t2"; ALTER TABLE "t3" DROP COLUMN "created";`. `generate` does not connect to a database, so it cannot tell whether data exists. | [tested] |
| 5b | Column renamed, no TTY (text mode) | Prints a `missing_hints` report with a rename snippet and a create snippet, exit 2, writes nothing. | [tested] |
| 5c | Same with `--output json` | `{"status":"missing_hints","unresolved":[{"type":"rename_or_create","kind":"column","entity":["public","t1","title"]}]}`, exit 2. | [tested] |
| 5d | Column renamed, with a pseudo-terminal | Interactive menu "Is t1.title column created or renamed from another column?" and waits for a key. This blocks CI or an agent that has a TTY. | [tested] |
| 5e | Non-interactive flag | No `--yes`. Use `--hints '<json>'` or `--hints-file`: `[{"type":"rename","kind":"column","from":["public","t1","name"],"to":["public","t1","title"]}]` gave `ALTER TABLE "t1" RENAME COLUMN "name" TO "title";`. A `create` hint gives add column plus drop column instead. `--explain` prints the plan and writes nothing. | [tested] |
| 5f | `confirm_data_loss` | Appears for `push` only (it checks whether the target has rows). The docs list it under `push`, not `generate`. | [source] |
| 5g | Type change | `generate` adds a cast automatically: `ALTER COLUMN "other" SET DATA TYPE integer USING "other"::integer;`. No prompt. | [tested] |
| 6a | `drizzle-kit check` in 1.0 | Checks the migration history: valid snapshots, parents present, folder order, and branch conflicts through the footprint check (2j). For Postgres it can also warn in an `ok` result when open branches need a merge migration or the schema differs from the migrations. `check --output json` gives `{"status":"ok"}` or a `check_error` envelope. Exit 1 on error. | [tested] [source] |
| 6b | Docs | The v0-to-v1 page lists: no journal, folder-per-migration, "Detects non-commutative migrations across branches", DAG from `prevIds`, footprint map, out-of-order migrations now applied, `name` column stores the folder name, remove `--ignore-conflicts` from Postgres scripts. | [source] |
| 6c | CLI flags in rc.5 | `generate`: `--explain`, `--fix-conflicts`, `--hints`, `--hints-file`, `--output text\|json`, `--custom`, `--name`. `check`: `--output`. `migrate`: `--config` only. | [tested] |
| 6d | Agent skill shipped in the package | `node_modules/drizzle-kit/skills/drizzle/*.md` documents all of the above (branches, merge migrations, errors, hints). Useful as a primary source. | [source] |

## Things to watch

- `generate` is blind to data. A drop is written without warning (5a). Review the SQL in the PR.
- A migration that must be non-transactional cannot go through `migrate()` (3c).
- Concurrent `migrate()` is not safe to rely on (3e, 3f). Run it once per deploy, or lock it ourselves.
- A merge migration appears only at the next real schema change (2c). After merging two migration branches, `check` passes but the history still has two leaves; this is fine for `migrate`.
- `--fix-conflicts` deletes migrations (2i). Only use it before the branch's migrations reach a shared database.

## Sources

- Installed package docs: `node_modules/drizzle-kit/skills/drizzle/migrations.md`, `generate.md`, `hints.md`, `output-modes.md`, `push.md`.
- Installed code: `drizzle-orm/migrator.js`, `pg-core/async/session.js` (`migrate`), `up-migrations/pg.js`, `node-postgres/migrator.js`; `drizzle-kit/cli.mjs` (`preparePushConfig`, `preparePullConfig`, `prepareMigrateConfig`).
- https://orm.drizzle.team/docs/v0-v1-changes
- https://orm.drizzle.team/docs/drizzle-kit-check
