---
"app": minor
---

The Template has a new architecture rule, A24: only a `*.test.ts(x)` file or a file under `test/` imports `@n8io/baseline-<package>/testing`, the entry a Package exports its test helpers from. Production code imports the Package's main entry, where its memory adapter is. `AGENTS.md` says so under Tests.
