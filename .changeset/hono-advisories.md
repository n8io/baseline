---
"app": patch
---

Clear the moderate advisory in the built server: `react-router-hono-server` moves to 4.1.9, which brings `@hono/node-server` 2.1.6. `docs/agents/dependency-updates.md` gains a step on what to do when Dependabot ends with `security_update_not_possible`.

To upgrade a Project: run `pnpm template-upgrade`; it takes `apps/app/package.json`, the doc and `piece-remove.ts`, and `pnpm install` refreshes your lockfile.
