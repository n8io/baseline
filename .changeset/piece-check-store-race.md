---
"app": patch
---

`pnpm piece-check` no longer fails when the pnpm store is empty, as in baseline's render-and-test jobs. It checks the unmodified tree first, alone, so that install fills the store, and only then checks the pieces two at a time. Before, two worktree installs could download into the empty store at once and fail with "failed to import".

To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-check.ts` and `docs/agents/pieces.md`.
