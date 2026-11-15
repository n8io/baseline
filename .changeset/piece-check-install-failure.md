---
"app": patch
---

`pnpm piece-check` now reports a failed `pnpm install` in a piece's worktree as "could not be checked", with the install's output, and never as "X can no longer be removed". Only a failing check after a good install blames the piece.

To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-check.ts` and `docs/agents/pieces.md`.
