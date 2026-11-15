---
"app": patch
---

Clear the moderate advisories in the Template's dependencies: `react-router-hono-server` moves to 4.1.9 (it brings `@hono/node-server` 2.1.6 into the built server), and `pnpm-workspace.yaml` overrides the old `@hono/node-server` and `minimatch` that the dev-server plugin and shadcn's `ts-morph` still pin. Run `pnpm template-upgrade` to take it.
