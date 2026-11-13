---
"app": minor
---

`structure.test.ts` now budgets `AGENTS.md` in bytes instead of lines (14,000, about 3 KB above the Template's own file), since every task loads it. It also fails when an `@CONTEXT.md` import is not alone on its line (in a sentence, Claude Code takes the punctuation after it as part of the path and loads nothing) or names a missing file. The check lives in `agent-docs-test-rules.ts`. A Project whose `AGENTS.md` is over the budget moves task-specific rules to `docs/agents/` and links them under `## Read when`.

`AGENTS.md` now says in words where the glossary is, for agents that do not follow `@` imports, and drops the Dependabot merge rule, which `docs/agents/dependency-updates.md` holds. `docs/agents/deploy.md` drops its Template upgrade line, which `template-upgrade.md` holds, and the walkthroughs no longer name a fixed `app-ci.yml` major.
