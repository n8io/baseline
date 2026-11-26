---
"app": minor
---

`pnpm glossary-check` exits 1 on any hit in the lines a branch adds, and on a crash, instead of warning. `app-ci.yml` no longer sets `continue-on-error` on its step, so a glossary alias or another context's term in an added line fails `check`. To upgrade a Project: run `pnpm glossary-check` and rename each hit before the first PR after this release.
