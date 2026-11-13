# @n8io/baseline-queue

Events, Consumers and Schedules on [pg-boss](https://github.com/timgit/pg-boss), in the app's own Postgres. An Event commits or rolls back with the rows that caused it, and an inbox skips a repeated Event.

```sh
pnpm add @n8io/baseline-queue
```

## Exports

- `queueMigrate({ databaseUrl, queuesRemoved?, vendor? })` (`vendor` takes `ssl`, `application_name` and `options` for the connection pg-boss opens to migrate): installs or upgrades pg-boss in schema `queue` and creates `queue.inbox`. Run it from the migrate entry.
- `queueCreate({ pgPool, role, vendor? })`, `Queue`: starts pg-boss on the shared pool. A `"publisher"` (the server) only sends; a `"worker"` also runs maintenance, cron and inbox pruning. `isAlive()` feeds `/livez`; `stop()` waits up to 15 s for running jobs, and `await using` calls it when its block ends. `vendor` takes pg-boss's own intervals, warnings and retention settings and passes them through. It throws on the keys `queueCreate` sets itself (`db`, `schema`, `migrate`, `schedule`, `supervise`, `openTelemetry`), on connection settings (the queue runs on your pool, so set them there), and on the ones that only act in `queueMigrate` or that the queue does not support. It is outside the contract: nothing in it is tested here, and moving off pg-boss deletes it.
- `Events`: how Events travel, whatever carries them: `consumersSubscribe(consumers)` (every process that publishes calls it at boot), `consumersStart(consumers)` (worker only), `publisherCreate(transaction)` and `isAlive()`. A composition root opens one and nothing else names the transport.
- `EventsPublisher`: one per transaction. `publish(name, data)` inside it, then `committed()` once it has committed; on a rollback, drop it.
- `queueEventsCreate(queue)`: `Events` on the queue. A publish writes on the transaction's client (an outbox), so `committed()` has nothing left to do.
- `queueEventsMemoryCreate(published?)`: records publishes in an array, for unit tests.
- `queueConsumerCreate(queueName, eventName, schema, run)`, `Consumer`: validates each Event with the schema and runs the Consumer with its output. `schema` is any [Standard Schema](https://standardschema.dev): a Zod, Valibot or ArkType schema goes in as it is. An Event that fails throws, which fails the job; the error names the paths that failed (a record's keys included) and never the validator's message, which may repeat the Event's values.
- `queueScheduleCreate(name, cron, run)`, `queueSchedulesRegister(queue, schedules, { env })`, `Schedule`: UTC cron jobs in the worker. `SCHEDULE_<NAME>` overrides a cron, or turns it `off`.
- `queueInboxInsert(transaction, inbox)`, `Inbox`: records the Event as handled in the caller's transaction; `false` means it was already handled.
- `queueJobRun(queueName, job, work)`: runs one job's work, logs a throw and counts dead letters (`baseline.queue.dead_letters`).
- `QueueSql`: anything with `query(text, values?)` on the Project's Postgres, such as a node-postgres pool or a transaction's client. `queueCreate`, `publisherCreate` and `queueInboxInsert` take it, so the package needs no `pg` types.
- `queueRetryLimit`: retries before a job moves to `<queueName>.dead` (4, so five attempts).

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
const billingOrderPlaced = queueConsumerCreate(
	"billing.order-placed", // queueName: <consumer domain>.<event>
	"order.placed", // eventName
	orderPlaced, // the Zod schema; `event` below is its output type
	(event, inbox) =>
		billingUseCases.invoiceCreate(
			billingOrderPlacedConsumerActor,
			{ customerId: event.customerId, amountCents: event.totalCents },
			inbox,
		),
);
const events = queueEventsCreate(queue);
await events.consumersStart([billingOrderPlaced]);

const fooStaleArchive = queueScheduleCreate(
	"foo.stale-archive",
	"0 3 * * *",
	() => fooUseCases.fooStaleArchive(fooScheduleActor),
);
await queueSchedulesRegister(queue, [fooStaleArchive], { env: ENV });
```

## Needs

- Peer: `@opentelemetry/api`. You bring the schema library (the Template uses Zod); the package imports none. The pool you pass to `queueCreate` is yours; pg-boss brings its own `pg` for `queueMigrate`.
- Env, by the template's convention: `DATABASE_URL`, and an optional `SCHEDULE_<NAME>` per Schedule.

## Tests

`pnpm test` needs Docker: it starts a Postgres container.
