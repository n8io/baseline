# Data rules

Read when touching a table, a migration or SQL.

- Postgres 17 or newer.
- Drizzle stays on the pinned 1.0 rc until 1.0 GA, because the `migrations/<ts>_<name>/` folder format needs 1.x. Move to GA when it ships.
- Change schemas with expand then contract. A rename is an added column in one release and a dropped one in a later release.
- Run `pnpm codegen` after editing a table file. A PR may only add folders under `migrations/`.
- On a migration conflict, delete your migration, rebase and run `pnpm codegen` again. Never use `--fix-conflicts` or `--hints`.
- Destructive SQL (`DROP`, `RENAME`, `ALTER COLUMN ... TYPE`, `SET NOT NULL`) needs a `destructive.md`. Adding one is a stop-and-ask.
- No foreign keys across Domains. Store another Domain's id as a plain indexed `uuid` column.
- Do not use `sql.raw` in `spi/`.
