---
"app": patch
---

`pnpm piece-check` no longer fails on an empty pnpm store, as on the first CI run after a lockfile change. It checks the unmodified tree first, alone, so that install fills the store, and only then checks the pieces two at a time. Before, two worktree installs could download into the empty store at once and fail with "failed to import".

To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-check.ts` and `docs/agents/pieces.md`.
