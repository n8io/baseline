---
"app": patch
---

CI now enforces the unit (2 min) and integration (3 min) budgets on the test command itself, with a message that names the budget, and the job limits sit a little above as a backstop. The Template's integration tests run four files at a time (`maxWorkers: 4`), so a Project's integration job no longer runs close to its limit on a 2-CPU runner.
