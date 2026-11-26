---
"app": minor
---

`pnpm glossary-check` exits 1 on any hit in the lines a branch adds, and on a crash, instead of warning. `app-ci.yml`'s `check` job runs it in a Project without `continue-on-error`, so a glossary alias or another context's term in an added line fails `check`. It does not run when `app-ci.yml` is called with an `artifact` (the Template's `render-and-test`), which has no git base; baseline's own `ci.yml` checks the Template. To upgrade a Project: run `pnpm glossary-check` and rename each hit before the first PR after this release.
