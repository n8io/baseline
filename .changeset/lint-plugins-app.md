---
"app": minor
---

Four rules move from the Vitest architecture tests into Biome GritQL plugins under `lint-plugins/`, wired through `overrides` in `biome.json`, so `pnpm check` and the editor report them: A15 (`sql.raw` in `adapters/outbound/`), A26 (system time in a Use case), the `process.env` part of A22, and the ban on mocks, spies and fake timers in tests. Messages keep the A-number. `lint-plugin-samples/` holds one failing sample per plugin, run by `lint-plugins.test.ts`. To upgrade a Project: run `pnpm template-upgrade`; keep your own `biome.json` overrides next to the new ones.
