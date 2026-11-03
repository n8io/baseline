---
"app": patch
---

Mutation testing is gone: no `pnpm test:mutation`, Stryker or `stryker.config.json`, and `app-ci.yml` has no `mutation` job (drop `ci / mutation` from your ruleset's required checks). `domain-create` now also copies foo's page tests (`test/unit/foo-{list,detail}.test.ts`, renamed) and, with a project's first domain, the home redirect test as `test/unit/home.test.ts`.
