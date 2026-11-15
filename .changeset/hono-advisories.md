---
"app": patch
---

Clear the moderate advisories in the Template's dependencies: `react-router-hono-server` moves to 4.1.9 (it brings `@hono/node-server` 2.1.6 into the built server), and `pnpm-workspace.yaml` overrides the old `@hono/node-server` and `minimatch` that the dev-server plugin and shadcn's `ts-morph` still pin. `docs/agents/dependency-updates.md` gains a step on what to do when Dependabot ends with `security_update_not_possible`.

To upgrade a Project: run `pnpm template-upgrade`; it takes `apps/app/package.json`, `pnpm-workspace.yaml`, the doc and `piece-remove.ts`, and `pnpm install` refreshes your lockfile.
