---
"app": patch
---

`pnpm piece-check` reports a failed `pnpm remove` or `pnpm add` during a piece's removal (registry error, network, store) as "could not be checked" with the command's output, instead of blaming the piece; a removal that fails on your code still blames the piece. `pnpm piece-remove` run by hand says the package manager failed and undoes the removal.

To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-remove.ts`, `scripts/piece-check.ts`, their tests, and `docs/agents/pieces.md`.
