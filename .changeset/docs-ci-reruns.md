---
"app": patch
---

Docs only. `docs/agents/dependency-updates.md` says a moved `app-ci.yml@v<major>` tag reaches a pull request only on a fresh `pull_request` run (push a commit or merge main): a re-run keeps the original run's workflow version, and a `workflow_dispatch` run does not clear a cancelled required check.

To upgrade a Project: run `pnpm template-upgrade`; it takes `docs/agents/dependency-updates.md`.
