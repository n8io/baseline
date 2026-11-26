---
"app": patch
---

`scripts/app-create.ts` is split into `app-create-*.ts` modules, one per concern (args, release, npm, ruleset, github, render, run). `pnpm app-create` and the names `app-create.ts` exports are unchanged.
