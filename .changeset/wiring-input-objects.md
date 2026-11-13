---
"app": major
"@n8io/baseline-cache": patch
"@n8io/baseline-pulsar": patch
---

The Template's wiring functions each take one input object: `connectionsOpen({ role })`, `redisOpen({ steps, url })`, `redisClientCreate({ url })`, `cacheStoreOpen({ redis })`, `liveHubOpen({ redis, steps })`, `queueOpen({ database, intakes, resources, role })`, `analyticsOpen({ steps, token })` and `errorTrackingOpen({ dsn, environment, steps })`. `src/connections.ts` now reads `ENV` from `#env` itself (rule A22 allows it, as it does `src/authn.ts`), so a call site passes only the role. `queueOpen` returns `{ events, queue }` and calls `eventsOpen` only once the queue is real, so `eventsOpen` takes a `Queue` and returns `Events`; the Pulsar guide shows the new shape. A Project that calls any of these from its own code changes each call to the object form.

`env-files.test.ts` checks `.env.development` and `.env.test` with `varlock load` itself instead of a hand-written parser of `.env.schema` decorators, so it also checks each value's type. Undeclared items and plain values in `.env.production` are still refused. The Template's piece markers are down from 87 to 82, and a root test keeps them at 91 or fewer, 6 per file (7 in `src/connections.ts`).
