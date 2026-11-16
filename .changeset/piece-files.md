---
"app": minor
---

A Project lists its own files that belong to a piece in `.template.json` as `"pieceFiles": { "<piece>": ["path", ...] }`; `pnpm piece-remove` and `pnpm piece-check` delete them with the piece, and stop with a clear message on an unknown piece or a path outside the Project. Keep such paths there instead of in `scripts/piece-remove.ts`, which an upgrade replaces. `docs/agents/pieces.md` no longer names a `context` marker in `src/server.ts`, and says where a new import goes so Biome never pulls a piece block apart.

To upgrade a Project: run `pnpm template-upgrade`; it takes `scripts/piece-remove.ts`, `scripts/piece-check.ts`, their tests, and `docs/agents/pieces.md`. Move any piece paths you added to `scripts/piece-remove.ts` into `pieceFiles` in `.template.json`.
