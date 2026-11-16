---
"app": patch
---

Docs only. `docs/agents/dependency-updates.md` says re-running failed jobs, or one job, keeps the first attempt's `app-ci.yml` version; re-run all jobs, merge main or push a commit to get a moved `v<major>` tag. A `workflow_dispatch` run does not clear a cancelled required check.

To upgrade a Project: run `pnpm template-upgrade`; it takes `docs/agents/dependency-updates.md`.
