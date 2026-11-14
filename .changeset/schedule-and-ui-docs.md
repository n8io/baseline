---
"app": minor
---

Two new agent docs, each with a "Read when" line in `AGENTS.md`:

- `docs/agents/schedules.md`: a Schedule's file pair (`<domain>Schedule` and `<domain>ScheduleCreate`) and its Actor, the `schedules` markers in `src/migrate.ts`, `src/worker.ts` and `.env.schema`, how `SCHEDULE_<NAME>` is named and where it acts, two Schedules in one Domain, "due" work as one repository method held equal by the contract test, catch-up and repeats, and how to run a Schedule on demand in a test (`<domain>ScheduleCreate(useCases).run()`).
- `docs/agents/ui.md`: the loader and action contract, a refused change as a message on the page with the Domain's status table, showing controls with its "can" predicates, `useLiveUpdates` (with `id: null`), form controls (native `select` without JavaScript, `datetime-local` as UTC), page tests on memory connections, and removing a page.

To upgrade a Project: `pnpm template-upgrade` adds both docs and their two "Read when" lines in `AGENTS.md`. The Template's `foo-schedule.test.ts` now runs the Schedule on memory ports instead of a mocked Use case; apply the same change to each Domain's `<domain>-schedule.test.ts` by hand if you want it.
