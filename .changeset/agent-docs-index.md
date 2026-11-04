---
"app": patch
---

Template docs: `AGENTS.md` keeps only the rules every task needs and ends with a `## Read when` index. Events, Bridges and Aggregates, Data rules, Tracing and spans, and Runtime notes move to `docs/agents/`, read only when the task needs them. `structure.test.ts` keeps `AGENTS.md` under 200 lines and checks that every linked doc exists and every doc is linked.
