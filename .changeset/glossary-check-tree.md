---
"app": patch
---

`glossary-check` takes the glossary and the tree to scan (`pnpm glossary-check [glossary] [tree]`, defaults `CONTEXT.md` and `.`), and no longer flags an alias inside a path or script name such as `test/integration` or `test:integration`.
