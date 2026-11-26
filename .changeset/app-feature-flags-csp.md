---
"app": patch
---

Fix the browser feature flag client being blocked by the Content Security Policy: `connect-src` now allows LaunchDarkly's origins (`featureFlagsLaunchDarklyClientOrigins()`) when `LAUNCHDARKLY_CLIENT_SIDE_ID` is set, and only then. `src/server.ts` uses `httpSecureHeadersCreate`. The policy always names `connect-src 'self'`. The piece-marker budget is now 95 (7 in `server.ts`). A Project that added the feature flags blocks by hand adds the `connectSrc` block to `src/server.ts`.
