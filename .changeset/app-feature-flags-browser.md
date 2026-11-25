---
"app": minor
---

Wire feature flags into the Template's browser. `src/ui/entry.client.tsx` waits for the flags to be ready before it hydrates and wraps the app in `FeatureFlagsProvider`, `src/ui/feature-flags.ts` holds the typed `useFeatureFlag`, and the root loader sends the Actor's id and the new `LAUNCHDARKLY_CLIENT_SIDE_ID` to the browser. Without the ID, or a signed-in Actor, every flag reads as its declared fallback and nothing is requested. `pnpm piece-remove feature-flags` removes all of it. The piece-marker budget is now 93. A Project adds the `server.ts` `getLoadContext` block and `root.tsx` loader block by hand, and sets `LAUNCHDARKLY_CLIENT_SIDE_ID` where it sets `LAUNCHDARKLY_SDK_KEY`.
