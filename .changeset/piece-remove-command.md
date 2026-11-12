---
"app": minor
---

`pnpm piece-remove <piece>` removes a piece of the stack (`ui`, `live`, `cache`, `redis` or `queue`) in one command: its files and blocks, its packages and the imports nothing uses any more. It refuses a tree with uncommitted changes and an order that cannot work, such as `redis` before the cache and live updates, and prints the next steps. `docs/agents/pieces.md` now names the one command per piece instead of shell blocks; adding a piece back is still `git revert` of its "Remove <piece>" commit.
