---
"app": patch
---

`pnpm template-upgrade` formats `.template.json` with Biome before it exits on a conflict, so `pnpm check` no longer fails on it after you resolve the markers. `docs/agents/template-upgrade.md` now says to take either side of a `src/env.d.ts` conflict, since `pnpm check` regenerates it.
