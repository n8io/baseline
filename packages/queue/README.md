# @n8io/baseline-queue

Events, Consumers and Schedules on [pg-boss](https://github.com/timgit/pg-boss), in the app's own Postgres. An Event commits or rolls back with the rows that caused it, Events with the same key reach each Consumer in order, and an inbox skips a repeated Event.

```sh
pnpm add @n8io/baseline-queue
```

## Exports

- `queueMigrate({ databaseUrl, queuesRemoved?, vendor? })` (`vendor` takes `ssl`, `application_name` and `options` for the connection pg-boss opens to migrate): installs or upgrades pg-boss in schema `queue` and creates `queue.inbox`. It also removes the queues an upgrade left behind (see [Upgrading to 8](#upgrading-to-8)). Run it from the migrate entry.
- `queueCreate({ pgPool, role, vendor? })`, `Queue`: starts pg-boss on the shared pool. A `"publisher"` (the server) only sends; a `"worker"` also runs maintenance, cron and inbox pruning. `isAlive()` feeds `/livez`; `blockedKeys()` lists the keys an Event that failed for good holds back, as `{ consumer, key, since }` (see [A blocked key](#a-blocked-key)); `stop()` waits up to 15 s for running jobs, and `await using` calls it when its block ends. `vendor` takes pg-boss's own intervals, warnings and retention settings and passes them through. It throws on the keys `queueCreate` sets itself (`db`, `schema`, `migrate`, `schedule`, `supervise`, `openTelemetry`), on connection settings (the queue runs on your pool, so set them there), and on the ones that only act in `queueMigrate` or that the queue does not support. It is outside the contract: nothing in it is tested here, and moving off pg-boss deletes it.
- `Events`: how Events travel, whatever carries them: `consumersSubscribe(consumers)` (every process that publishes calls it at boot), `consumersStart(consumers)` (worker only), `publisherCreate(transaction)` and `isAlive()`. A composition root opens one and nothing else names the transport.
- `EventsPublisher`: one per transaction. `publish({ name, data, key })` inside it, then `committed()` once it has committed; on a rollback, drop it. `key` is the id of the entity the Event is about, and is never empty (see [Order](#order)).
- `queueEventsCreate(queue)`: `Events` on the queue. A publish writes on the transaction's client (an outbox), so `committed()` has nothing left to do.
- `queueEventsMemoryCreate({ published? })`: records each publish in the `published` array as `{ name, data, key }`, for unit tests. The argument is optional.
- `queueConsumerCreate({ queueName, eventName, schema, run })`, `Consumer`: validates each Event with the schema and runs the Consumer with its output. `schema` is any [Standard Schema](https://standardschema.dev): a Zod, Valibot or ArkType schema goes in as it is. An Event that fails throws, which fails the job; the error names the paths that failed (a record's keys included) and never the validator's message, which may repeat the Event's values.
- `queueScheduleCreate({ name, cron, run })`, `queueSchedulesRegister({ queue, schedules, env })`, `Schedule`: UTC cron jobs in the worker. `SCHEDULE_<NAME>` overrides a cron, or turns it `off`.
- `queueInboxInsert(transaction, inbox)`, `Inbox`: records the Event as handled in the caller's transaction; `false` means it was already handled.
- `queueJobRun({ queueName, job, work })`: runs one job's work, logs a throw and counts dead letters (`baseline.queue.dead_letters`). With `job.key`, the last failure is logged as a blocked key.
- `QueueSql`: anything with `query(text, values?)` on the Project's Postgres, such as a node-postgres pool or a transaction's client. `queueCreate`, `publisherCreate` and `queueInboxInsert` take it, so the package needs no `pg` types.
- `queueRetryLimit`: retries before a job is copied to `<queueName>.dead` (4, so five attempts, about 10 s, 20 s, 40 s and 80 s apart).

## Example

```ts
import type { Actor } from "@n8io/baseline-authn";
import { z } from "zod";
import {
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
	queueScheduleCreate,
	queueSchedulesRegister,
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
await queueSchedulesRegister({ env: ENV, queue, schedules: [fooStaleArchive] });
```

## Order

Every publish names a key: the id of the entity the Event is about. Each Consumer gets the Events of one key one at a time, in the order their transactions committed, on any number of workers. Events of different keys run beside each other.

- **At publish.** A publish locks its key until its transaction ends, so two transactions never publish for one key at once, and the Event is stamped while the lock is held. Publish after the write the Event is about. A transaction that publishes for several keys should always take them in the same order.
- **At the Consumer.** A worker fetches up to 10 Events at a time, each of another key, and runs 4 of them at once. While an Event waits for its retry, the later Events of its key wait behind it; other keys carry on. A worker that dies mid-Event is noticed within about a minute, and a handler that runs longer than five minutes is failed and retried.
- **Throughput.** Measured against one Postgres 18: 12 workers drain 2,000 waiting Events over 50 keys in under 2 s (about 1,100 a second), and a single busy key drains at about 170 Events a second, on 1 worker or 12.
- **Traces.** A Consumer runs in the trace of the request that published its Event, also when one fetch brings several.

## A blocked key

An Event that fails all five attempts stays in its queue as failed, and a copy goes to `<queueName>.dead`. Strict order means the later Events of that key now wait until someone decides; every other key carries on. The worker logs it at error level ("its key is blocked until released") with the queue and the key.

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

Or give the Event up, so the key moves on without it. The copy in `billing.order-placed.dead` stays for the record:

```sql
DELETE FROM queue.job
WHERE name = 'billing.order-placed.ordered' AND singleton_key = 'order_123' AND state = 'failed';
```

## Upgrading to 8

Releases before 8 kept a Consumer's jobs in an unordered queue named `<queueName>`, subscribed to `<eventName>`. From 8 they are in `<queueName>.ordered`, subscribed to `<eventName>.ordered`. Nothing is moved and no step is yours:

1. During the rollout, processes of the old release keep publishing to the old queue and working it. Processes of the new release publish to the ordered queue and work both, so no Event is lost or waits for the rollout to end.
2. Events left in the old queue run as they did before, without a key, so they have no order among themselves or against new Events. If that matters for a Consumer, let its queue empty before you deploy.
3. A later `queueMigrate` removes the old queue, once nothing in it is waiting or running and nothing has been published to it for a day.

A rollback to the old release leaves the Events already in the ordered queues waiting until you roll forward again.

## Needs

- Peer: `@opentelemetry/api`. You bring the schema library (the Template uses Zod); the package imports none. The pool you pass to `queueCreate` is yours; pg-boss brings its own `pg` for `queueMigrate`.
- Env, by the template's convention: `DATABASE_URL`, and an optional `SCHEDULE_<NAME>` per Schedule.

## Tests

`pnpm test` needs Docker: it starts a Postgres container.
