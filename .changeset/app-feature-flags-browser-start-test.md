---
"app": patch
---

Test the browser feature flag startup that `entry.client.tsx` runs. The wiring now lives in `featureFlagsBrowserStart({ page, tree, create? })` in `src/ui/feature-flags-browser.tsx`, with tests for a page that has the config script, one without it, one with only React Router's state (the earlier bug) and a malformed script. Architecture rule A35 fails if `entry.client.tsx` reads `__reactRouterContext`.
