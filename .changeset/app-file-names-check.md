---
"app": major
---

Architecture rule A23 now checks file names: a file is named after its primary export without `Create` (`invoice-routes.ts` exports `invoiceRoutesCreate`), or after the subject its exports share (`cursor.ts` exports `cursorEncode`). An outbound adapter's dot is a word break (`invoice-repository.postgres.ts` exports `invoiceRepositoryPostgresCreate`), and a test helper file `<area>-test-<thing>.ts` is named after `<area>Test`. Tests, `index.ts`, commands in `scripts/`, the composition roots, `<aggregate>-table.ts` and files exporting only types, classes, components, hooks and React Router's names are not checked.

To upgrade a Project: run `pnpm check`; for each file it names, rename the file after its primary export, or rename its exports to start with the file's name.

`pnpm api-smoke` now defaults `--url` to `http://localhost:$PORT`, the port this worktree's `pnpm dev` serves on, instead of port 3000.
