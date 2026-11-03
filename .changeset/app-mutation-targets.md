---
"app": patch
---

`pnpm test:mutation` skips files only integration tests can cover (Postgres and Redis adapters, tables, `src/server.ts`, `src/worker.ts`, `src/seed.ts`, `src/ui/routes.ts`, `src/ui/context.ts`), and `domain-create` also copies foo's page tests (`test/unit/foo-{list,detail}.test.ts`, renamed) and, with a first domain, the home redirect test as `test/unit/home.test.ts`. A project's first domain now passes `ci / mutation`.
