---
"app": minor
---

A Project can now remove the queue and the Worker with the steps in `docs/agents/pieces.md`: each Domain's Events and Schedules, `src/worker.ts`, its compose service, its image entry and the `SCHEDULE_*` overrides go together, and each Domain's transaction becomes a plain Postgres transaction. `pnpm domain-create` leaves them out of new Domains once `@n8io/baseline-queue` is gone. Removing the UI pages now edits the `dev` script in place instead of replacing it, so the two removals work in either order.
