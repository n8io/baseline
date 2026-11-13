---
"@n8io/baseline-queue": major
"app": major
---

Workers stay up through a Postgres failover, and Schedules are safe in a rolling deploy.

- **Liveness.** `queue.isAlive()` is false only when the worker's own poll loop hangs. A poll that fails counts as proof the loop runs, so a Postgres outage of any length no longer makes every Worker fail `/livez` and restart together; they carry on by themselves when Postgres is back. A process that cannot reach Postgres at boot still fails and never reports ready.
- **Breaking:** `queueSchedulesRegister` is replaced by two functions. `queueSchedulesSync({ databaseUrl, schedules, env })` adds, updates and removes Schedules from the migrate entry, once per deploy with the newest code. `queueSchedulesStart({ queue, schedules, env })` runs them in the worker and changes nothing: a Worker of the previous version that boots mid-rollout can no longer remove a new Schedule or put an old cron back. A Schedule the database does not hold is not started and is logged as a warning.
- `queueCreate` takes `concurrency`: how many Events a worker runs at once across all its Consumers (default 4). It was 4 per Consumer, which let a Worker with a few Consumers use up its own pool.
- Every worker looks for blocked Event keys once a minute, logs each new one at error level and reports `baseline.queue.blocked_keys` per Consumer, so a key blocked by an Event the queue failed by itself is seen too.
- Queue errors that pg-boss reports as plain objects are logged as an `Error` with a message, a stack and the object as its `cause`. A worker whose queue `queueMigrate` has removed logs one warning and stops polling it, where it used to log an error on every poll.
- Template: `src/migrate.ts` syncs the Schedules, `src/worker.ts` starts them, and each Domain's `api/<domain>-schedule.ts` exports its name and cron as `<domain>Schedule` beside `<domain>ScheduleCreate`. `src/connections.ts` runs one query at boot, so a Server or Worker that cannot reach Postgres never reports ready. The Worker no longer waits 5 s before it shuts down, since no load balancer sends it traffic, and it runs one Event fewer at once than its pool has connections.

To upgrade a Project: in each `api/<domain>-schedule.ts` export `<domain>Schedule = { cron, name }` and spread it into `queueScheduleCreate`; export it from `api/index.ts`; in `src/migrate.ts` call `queueSchedulesSync({ databaseUrl, env: ENV, schedules: [...] })` after `queueMigrate`; in `src/worker.ts` rename `queueSchedulesRegister` to `queueSchedulesStart` and set `drainDelayMs: 0`; copy the query in `connectionsOpen` and the `concurrency` line in `src/queue-open.ts`. Run migrate before the new Workers start, as every deploy does.
