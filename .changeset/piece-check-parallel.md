---
"app": patch
---

`pnpm piece-check` checks the pieces at the same time, one per CPU, each on its own throwaway worktree with a unique name, so two runs on one machine never collide. Each piece prints one result line, and a failing piece's output is printed at the end. The checks per piece and the exit code are unchanged; a broken tree still blames no piece, and neither does a check that crashes or is killed.

To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-check.ts`, its test and `docs/agents/pieces.md`.
