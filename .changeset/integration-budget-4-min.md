---
"app": patch
---

The integration budget is 4 minutes, up from 3, at the owner's request: `pnpm test:integration` runs under `timeout 4m` in `app-ci.yml`, the integration job limit is 6 minutes, and AGENTS.md `## Verify` says 4 min. A Project that copies the budget line from the Template's AGENTS.md changes `(3 min budget)` to `(4 min budget)`.
