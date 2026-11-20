---
"app": minor
---

Template tidy-up from the final consistency audit. A `*.test.tsx` file now runs and is placement-checked like a `.test.ts`. `pnpm api-check`, `pnpm sdk-generate` and `pnpm check` take `--help` (sdk-generate used to run and rewrite files), every help line reads "this help", and scripts shell out through `processRun`/`gitRun` except where an exit status is the answer. Scripts share `argsFail` from `scripts/args.ts`; `nextStepsText` is `aggregateNextStepsText`. Optional script inputs take `null`. Glossary words are capitalised in messages and the generator-copied comments. Docs: a new docs/agents/ports.md (calling a service outside the app), where a new Event is defined, the piece-marker rule behind a "writing code that uses one" trigger, Worker and Server capitalised, `_Avoid_` aliases that no longer collide with the docs.

To upgrade a Project: a script of your own that imported `nextStepsText` from aggregate-create.ts imports `aggregateNextStepsText`.
