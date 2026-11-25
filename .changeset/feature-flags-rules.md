---
"app": minor
---

Lint and architecture rules for feature flags: only `@n8io/baseline-feature-flags` imports a flag vendor's SDK (A31, a Biome plugin), `featureFlagsDefine` is called only in `src/flags.ts` (A32), a flag key is written as a string literal only there (A33), and a flag value is never cast with `as` (A34).
