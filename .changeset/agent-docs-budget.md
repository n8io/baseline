---
"app": minor
---

`structure.test.ts` now budgets `AGENTS.md` in bytes instead of lines: 12,000 for the file and 24,000 with the glossary it imports, since every task loads both. It also fails when an `@CONTEXT.md` import is not alone on its line (Claude Code then loads nothing) or names a missing file. The check lives in `agent-docs-test-rules.ts`. `AGENTS.md` now says in words where the glossary is, for agents that do not follow `@` imports, and the walkthroughs no longer name a fixed `app-ci.yml` major.
