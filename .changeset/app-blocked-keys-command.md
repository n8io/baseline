---
"app": minor
---

New entry `src/blocked-keys.ts` (`pnpm blocked-keys` locally, `node src/blocked-keys.ts` in a pod): alone it lists the blocked Event keys, and `retry <consumer> <key>` or `give-up <consumer> <key>` releases one. It exits 1 when nothing was released. Part of the queue piece.
