---
"app": patch
---

`pnpm test:e2e` also holds a Lighthouse performance budget for the sign-in page (score, LCP, TBT, CLS, bytes and requests, set from a measured baseline) and a cold-start check that the production build serves the sign-in page within 10 s. It adds `lighthouse` (pinned exactly) as a dev dependency; it drives the Chromium Playwright launches.
