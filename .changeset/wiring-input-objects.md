---
"app": major
"@n8io/baseline-cache": patch
"@n8io/baseline-pulsar": patch
---

The Template's wiring functions each take one input object: `connectionsOpen({ role })`, `redisOpen({ steps, url })`, `redisClientCreate({ url })`, `cacheStoreOpen({ redis })`, `liveHubOpen({ redis, steps })`, `queueOpen({ database, intakes, resources, role })`, `analyticsOpen({ steps, token })` and `errorTrackingOpen({ dsn, environment, steps })`. `src/connections.ts` now reads `ENV` from `#env` itself (rule A22 allows it, and `src/events-open.ts`, where the Pulsar guide reads `PULSAR_URL`), so a call site passes only the role. `queueOpen` returns `{ events, queue }` and calls `eventsOpen` only once the queue is real, so `eventsOpen` takes a `Queue` and returns `Events`; the Pulsar guide shows the new shape.

To upgrade, change every `connectionsOpen(ENV, "publisher")` to `connectionsOpen({ role: "publisher" })` (and `"worker"` likewise), and drop the `ENV` import where nothing else uses it. Each Domain's copied tests call it: `spi/index.test.ts`, `spi/index-queue.test.ts`, `api/<domain>-live.test.ts`, `ui/routes/<domain>-list.test.ts` and `ui/routes/<domain>-detail.test.ts`. Change any call of the other functions above in the Project's own code to the object form. A Project with its own `src/events-open.ts` changes its `queue` type to `Queue` and its return type to `Events`.

`env-files.test.ts` checks `.env.development` and `.env.test` with `varlock load` itself instead of a hand-written parser of `.env.schema` decorators, so it now also checks each value's type. It reads only the committed files, never a `.local` one. Undeclared items and plain values in `.env.production` are still refused. The Template's piece markers are down from 87 to 82, and a root test keeps them at 91 or fewer, 6 per file (7 in `src/connections.ts`).

The Template's CI now calls `app-ci.yml@v6`.
