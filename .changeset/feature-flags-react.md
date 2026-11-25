---
"@n8io/baseline-feature-flags": minor
---

The React layer on `/react`: `featureFlagsReactCreate(flagDefs)` returns a typed `FeatureFlagsProvider` and `useFeatureFlag`. The hook re-renders only for its own flag, keeps object flags referentially stable, and returns the declared fallback on the server.
