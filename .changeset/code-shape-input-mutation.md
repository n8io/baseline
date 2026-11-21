---
"app": major
---

New architecture rule A30: a function never edits its input (no property assignment, `delete`, or push/sort/splice and the like on a parameter), unless `// mutates: <why>` sits right above it. The Template follows it: `analyticsOpen`, `errorTrackingOpen`, `liveHubOpen`, `queueOpen` and `redisOpen` take the shutdown steps so far and return them with their own added (`ShutdownSteps` from `src/shutdown-step-add.ts`), `liveHubOpen` takes `role`, and `connectionsOpen` assembles them. After upgrading, run `pnpm test` and fix what A30 names.
