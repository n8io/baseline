---
"app": minor
---

`pnpm piece-check` runs `pnpm check` and `pnpm test` on the unmodified tree first and stops with "fix the tree first" when they fail, so a failing test no longer blames every piece. `pnpm template-upgrade` renders both releases with the Project's removed pieces already removed (their package, files, blocks and env lines), so a removed piece no longer comes back as a conflict.
