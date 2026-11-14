---
"app": minor
---

Three small checks the DX fixes left open, and two rough edges.

- Rule A14 now sees another Domain's id in a plain `uuid("proposer_team_id")` column (the shape `data.md` tells people to use) and in a column helper hoisted into a sibling `spi/` file, so the `<other>.deleted` Consumer can no longer be forgotten. A Project whose table stores another Domain's id without that Consumer fails `pnpm test` after upgrading: add the Consumer.
- `glossary-check` reads JSX text in `.tsx` files: single-line text between a tag's `>` and the next `<` or `{`, without parentheses, `;`, `=`, `|` or `&`. Text after a `{...}`, after a multi-line opening tag or after a self-closing tag is still not read. Two Foo comments no longer use the aliases "integration" and "transport", so a Project's first Domain PR is not warned.
- `app-ci.yml` runs `shellcheck` on every `*.sh` in the `check` job.
- A Server or Worker that cannot open a connection at boot logs one structured fatal line and exits 1, instead of a raw `pg-pool` stack.
- Running one `*.postgres.test.ts` no longer asks for `pnpm build`: the stale-build check moved to the integration helper that starts the Server.
