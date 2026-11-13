---
"app": major
"@n8io/baseline-cache": major
"@n8io/baseline-live": major
"@n8io/baseline-postgres": major
"@n8io/baseline-queue": major
"@n8io/baseline-authn": patch
"@n8io/baseline-pulsar": patch
---

A function with three or more inputs takes one typed input object, and Biome's `useMaxParams` (max 2) now fails on a third parameter in the packages and the Template. A callback whose shape a library fixes (pino's `logMethod`, the Pulsar client's log, `String.replace`) carries a `biome-ignore` naming that library.

Breaking changes in the packages, with the new call:

- `@n8io/baseline-cache`: `CacheStore.set({ json, key, ttlMs })`. A Project's own `CacheStore` changes its `set` the same way. `Cache<T>.set(id, value)` is unchanged.
- `@n8io/baseline-live/client`: `useLiveUpdates({ channel, id, pathPrefix? })`.
- `@n8io/baseline-postgres`: `postgresTransactionRun({ pgPool, timeoutMs?, work })`.
- `@n8io/baseline-queue`: `queueConsumerCreate({ eventName, queueName, run, schema })`, `queueScheduleCreate({ cron, name, run })`, `queueSchedulesRegister({ env, queue, schedules })` and `queueJobRun({ job, queueName, work })`.

`@n8io/baseline-authn` and `@n8io/baseline-pulsar` change only inside.

In the Template, `useLiveUpdates`, `queueScheduleCreate`, `queueSchedulesRegister` and the test helpers move to the object form. A Use case that a Consumer calls takes the `inbox` in its input, `u.invoiceCreate(actor, { amountCents, customerId, inbox })`, so a Use case keeps two parameters. To upgrade a Project: change each call above, including every Domain's `api/<domain>-schedule.ts` (`queueScheduleCreate`), `src/worker.ts` (`queueSchedulesRegister`), each `ui/routes/<domain>-detail.tsx` (`useLiveUpdates`) and each Consumer and the Use case it calls; then run `pnpm check`, which names any function left with three parameters.
