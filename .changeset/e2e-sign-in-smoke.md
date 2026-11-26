---
"app": patch
---

`pnpm test:e2e` builds the app and runs `test/e2e/` in one headless Chromium against the production build on memory adapters (no Docker): the sign-in page renders, logs no console errors and has no serious or critical axe violations. It adds `playwright` (pinned exactly, to match the installed browser) and `axe-core` as dev dependencies; run `pnpm exec playwright install chromium` once where no Chromium is installed. A Project's tests may now sit in `test/e2e/`.
