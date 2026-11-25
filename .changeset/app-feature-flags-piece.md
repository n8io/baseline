---
"app": minor
---

The `feature-flags` piece: flags declared once in `src/flags.ts`, opened in `src/feature-flags-open.ts` (LaunchDarkly with `LAUNCHDARKLY_SDK_KEY`, else every flag answers its fallback) and shared through `connections.featureFlags`. `pnpm piece-remove feature-flags` takes it out.
