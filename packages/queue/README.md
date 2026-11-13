# @n8io/baseline-queue

Events, Consumers and Schedules on [pg-boss](https://github.com/timgit/pg-boss), in the app's own Postgres. An Event commits or rolls back with the rows that caused it, Events with the same Event key reach each Consumer in order, and an inbox skips a repeated Event.

```sh
pnpm add @n8io/baseline-queue
```

## Exports

- `queueMigrate({ databaseUrl, queuesRemoved?, vendor? })` (`vendor` takes `ssl`, `application_name` and `options` for the connection pg-boss opens to migrate): installs or upgrades pg-boss in schema `queue` and creates `queue.inbox`. It also removes the queues an upgrade left behind (see [Upgrading to 8](#upgrading-to-8)). Run it from the migrate entry.
- `queueCreate({ pgPool, role, concurrency?, vendor? })`, `Queue`: starts pg-boss on the shared pool. A `"publisher"` (the server) only sends; a `"worker"` also runs maintenance, cron and inbox pruning. `concurrency` is how many Events and Schedule runs a worker has under way at once, across all its Consumers and Schedules (default 4); keep it below the pool's size, since each holds a connection while it runs. `isAlive()` feeds `/livez` (see [Health](#health)); `blockedKeys()` lists the Event keys an Event that failed for good holds back, as `{ consumer, key, since }` (see [A blocked key](#a-blocked-key)); `stop()` waits up to 15 s for running jobs, and `await using` calls it when its block ends. `vendor` takes pg-boss's own intervals, warnings and retention settings and passes them through. It throws on the keys `queueCreate` sets itself (`db`, `schema`, `migrate`, `schedule`, `supervise`, `openTelemetry`), on connection settings (the queue runs on your pool, so set them there), and on the ones that only act in `queueMigrate` or that the queue does not support. It is outside the contract: nothing in it is tested here, and moving off pg-boss deletes it.
- `Events`: how Events travel, whatever carries them: `consumersSubscribe(consumers)` (every process that publishes calls it at boot), `consumersStart(consumers)` (worker only), `publisherCreate(transaction)` and `isAlive()`. A composition root opens one and nothing else names the transport.
- `EventsPublisher`: one per transaction. `publish({ name, data, key })` inside it, then `committed()` once it has committed; on a rollback, drop it. `key` is the Event key: the id of the entity the Event is about, never empty (see [Order](#order)).
- `queueEventsCreate(queue)`: `Events` on the queue. A publish writes on the transaction's client (an outbox), so `committed()` has nothing left to do.
- `queueEventsMemoryCreate({ published? })`: records each publish in the `published` array as `{ name, data, key }`, for unit tests. The argument is optional.
- `queueConsumerCreate({ queueName, eventName, schema, run })`, `Consumer`: validates each Event with the schema and runs the Consumer with its output. `schema` is any [Standard Schema](https://standardschema.dev): a Zod, Valibot or ArkType schema goes in as it is. An Event that fails throws, which fails the job; the error names the paths that failed (a record's keys included) and never the validator's message, which may repeat the Event's values.
- `queueScheduleCreate({ name, cron, run })`, `Schedule`: a UTC cron job. `queueSchedulesSync({ databaseUrl, schedules, env, vendor? })` writes the Schedules to the database from the migrate entry, and `queueSchedulesStart({ queue, schedules, env })` runs them in the worker (see [Schedules](#schedules)). `SCHEDULE_<NAME>` overrides a cron, or turns it `off`.
- `queueInboxInsert(transaction, inbox)`, `Inbox`: records the Event as handled in the caller's transaction; `false` means it was already handled.
- `QueueSql`: anything with `query(text, values?)` on the Project's Postgres, such as a node-postgres pool or a transaction's client. `queueCreate`, `publisherCreate` and `queueInboxInsert` take it, so the package needs no `pg` types.

## Example

```ts
import type { Actor } from "@n8io/baseline-authn";
import { z } from "zod";
import {
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
	queueScheduleCreate,
	queueSchedulesStart,
} from "@n8io/baseline-queue";

// The Event's schema, in the publishing Domain's models. Here it is Zod.
const orderPlaced = z.object({
	customerId: z.string(),
	totalCents: z.number().int(),
});

// The worker's composition root.
const queue = await queueCreate({ pgPool, role: "worker" });

// Each Consumer calls its Use case as its own machine Actor.
const billingOrderPlacedConsumerActor: Actor = {
	id: "billing-order-placed-consumer",
	kind: "client",
	scopes: ["billing:invoice-create"],
};
const billingOrderPlaced = queueConsumerCreate({
	eventName: "order.placed",
	queueName: "billing.order-placed", // <consumer domain>.<event>
	run: (event, inbox) =>
		billingUseCases.invoiceCreate(billingOrderPlacedConsumerActor, {
			amountCents: event.totalCents,
			customerId: event.customerId,
			inbox,
		}),
	schema: orderPlaced, // the Zod schema; `event` above is its output type
});
const events = queueEventsCreate(queue);
await events.consumersStart([billingOrderPlaced]);

const fooStaleArchive = queueScheduleCreate({
	cron: "0 3 * * *",
	name: "foo.stale-archive",
	run: () => fooUseCases.fooStaleArchive(fooScheduleActor),
});
// The migrate entry has synced it: queueSchedulesSync({ databaseUrl, env: ENV, schedules: [fooStaleArchive] }).
await queueSchedulesStart({ env: ENV, queue, schedules: [fooStaleArchive] });
```

## Order

Every publish names an Event key: the id of the entity the Event is about. Each Consumer gets the Events of one Event key one at a time, in the order their transactions committed, on any number of workers. Events of different Event keys run beside each other. Below, "key" means the Event key.

- **At publish.** A publish locks its key until its transaction ends, so two transactions never publish for one key at once, and the Event is stamped while the lock is held. Publish after the write the Event is about. A transaction that publishes for several keys should always take them in the same order.
- **At the Consumer.** A worker fetches up to 10 Events at a time per Consumer, each of another key, runs up to `concurrency` of them at once, counted across all its Consumers and Schedules (4 unless `queueCreate` says otherwise; a fetch takes no more than that) and settles each as it ends, so another worker can take that key's next Event at once; the same worker fetches again when its slowest Event of the fetch ends. While an Event waits for its retry, the later Events of its key wait behind it; other keys carry on. A worker that dies mid-Event is noticed within 30 to 90 s. A fetch still running after five minutes has its unfinished Events failed and retried, so keep a Consumer well under that.
- **Throughput.** Measured once on a development machine against one Postgres 18, with a Consumer that writes one row: 12 workers drain 2,000 waiting Events over 50 keys at about 1,000 a second, and a single busy key drains at about 150 Events a second, on 1 worker or 12. The package's tests hold the single key to 20 a second.
- **Traces.** A Consumer runs in the trace of the request that published its Event, also when one fetch brings several. In such a fetch the Consumer has no span of its own: its spans hang off the publishing request's, and an `err` result marks no span.

## A blocked key

An Event that fails all five attempts stays in its queue as failed, and a copy goes to `<queueName>.dead`. Strict order means the later Events of that key now wait until someone decides; every other key carries on. The worker logs it at error level ("its key is blocked until released") with the queue and the key. An Event the queue fails itself (a dead worker or a fetch out of time, five times over) blocks its key without that log line. So every worker also looks once a minute: it logs each blocked key it has not logged yet at error level ("Event key is blocked until released") and sets the gauge `baseline.queue.blocked_keys` to the number of blocked keys per Consumer (`messaging.destination.name`). Every worker reports the same count, so alert on its maximum across workers being above 0, not on a sum.

Decide within 7 days. After that pg-boss deletes the failed Event, and the key moves on without it.

List what is blocked with `queue.blockedKeys()`, or in SQL:

```sql
SELECT name, singleton_key AS key, completed_on AS since
FROM queue.job WHERE policy = 'key_strict_fifo' AND state = 'failed';
```

Then release the key one of two ways. The queue's name is the Consumer's `queueName` plus `.ordered`.

Run the Event again, once the cause is fixed and deployed. It runs before the Events waiting behind it:

```sql
UPDATE queue.job
SET state = 'retry', retry_limit = retry_limit + 1, completed_on = NULL, start_after = now()
WHERE name = 'billing.order-placed.ordered' AND singleton_key = 'order_123' AND state = 'failed';
```

Or give the Event up, so the key moves on without it. The copy in `billing.order-placed.dead` stays for the record; redriving that copy later runs the Event after the ones that were waiting behind it:

```sql
DELETE FROM queue.job
WHERE name = 'billing.order-placed.ordered' AND singleton_key = 'order_123' AND state = 'failed';
```

## Schedules

A Schedule has two halves, in two processes:

- **When it runs** lives in the database. `queueSchedulesSync` makes the database match the list it is given: it adds each Schedule, updates a changed cron, and removes one that is no longer listed or is turned `off`. Call it from the migrate entry, after `queueMigrate`. Migrate runs once per rollout with the newest code, so the list in the database is always the newest version's. It needs only each Schedule's `name` and `cron`.
- **What it runs** lives in the worker. `queueSchedulesStart` starts a worker for each Schedule the database holds and changes nothing there. During a rollout a worker of the previous version may boot late; it cannot remove a Schedule only the new version has, or put an old cron back. A Schedule the database does not hold is not started, and the worker logs a warning ("Schedule is not in the database"): run migrate.

The `SCHEDULE_<NAME>` overrides act where the sync runs, so set them in the environment the migrate entry gets; the worker reads only `off`, to skip a Schedule without a warning. Every cron is validated before the sync changes anything; a bad one fails migrate and names the Schedule or its `SCHEDULE_<NAME>` variable. Each tick runs once, on one worker, however many workers there are.

## Health

`queue.isAlive()` answers one question: is this process's poll loop still turning? A worker polls every 2 s. Each poll that ends, in a fetch or in an error, counts. Only when no poll has ended for 60 s is the worker reported dead, which means the loop itself hangs and a restart is the fix.

So a Postgres outage or failover never fails liveness, as long as a poll fails instead of hanging: give the pool a query timeout well under 60 s (`postgresPoolCreate` sets 15 s). Polls fail, the failures of each queue are logged as "Queue error" once per 30 s, and the worker stays up and carries on by itself when Postgres is back. A dependency being down belongs to the startup check: a process that cannot reach Postgres fails `queueCreate` and never reports ready. A publisher has no poll loop and is always alive.

pg-boss reports a failed poll as a plain object; the package logs it as an `Error` with the same message, stack and `code`, and that object as its `cause`. When `queueMigrate` removes a queue that a running worker still polls (an old unordered queue, or one in `queuesRemoved`), that worker logs one warning ("Queue was removed") and stops polling it.

## Upgrading to 8

Upgrading across 8 also moves Schedules: `queueSchedulesRegister` is gone. Call `queueSchedulesSync` in the migrate entry and `queueSchedulesStart` in the worker. A worker of the release before 8 still rewrites the Schedules at boot, so one that restarts during this one rollout can undo the sync until migrate runs again; after the rollout no such worker is left.

Releases before 8 kept a Consumer's jobs in an unordered queue named `<queueName>`, subscribed to `<eventName>`. From 8 they are in `<queueName>.ordered`, subscribed to `<eventName>.ordered`. Nothing is moved and no step is yours:

1. During the rollout, processes of the old release keep publishing to the old queue and working it. Processes of the new release publish to the ordered queue and work both, so no Event is lost or waits for the rollout to end.
2. Events left in the old queue run as they did before, without a key, so they have no order among themselves or against new Events. If that matters for a Consumer, let its queue empty before you roll out.
3. A later `queueMigrate` removes the old queue, once the ordered queue is a week old, nothing in the old one is waiting or running and nothing has been published to it for a week.

A rollback to the old release leaves the Events already in the ordered queues waiting until you roll forward again; pg-boss deletes a waiting Event after 14 days. Do not roll back to it once the old queues are gone: its publishes would find no queue and be lost.

## Needs

- Peer: `@opentelemetry/api`. You bring the schema library (the Template uses Zod); the package imports none. The pool you pass to `queueCreate` is yours; pg-boss brings its own `pg` for `queueMigrate`.
- Env, by the template's convention: `DATABASE_URL`, and an optional `SCHEDULE_<NAME>` per Schedule.

## Tests

`pnpm test` needs Docker: it starts a Postgres container.
