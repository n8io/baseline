# @n8io/baseline-queue

Events, Consumers and Schedules on [pg-boss](https://github.com/timgit/pg-boss), in the app's own Postgres. An Event commits or rolls back with the rows that caused it, and an inbox skips a repeated Event.

```sh
pnpm add @n8io/baseline-queue
```

## Exports

- `queueMigrate({ databaseUrl, queuesRemoved? })`: installs or upgrades pg-boss in schema `queue` and creates `queue.inbox`. Run it from the migrate entry.
- `queueCreate({ pgPool, role })`, `Queue`: starts pg-boss on the shared pool. A `"publisher"` (the server) only sends; a `"worker"` also runs maintenance, cron and inbox pruning. `isAlive()` feeds `/livez`; `stop()` waits up to 15 s for running jobs.
- `queueEventsPgBossCreate(queue, pgClient)`, `QueueEvents`: publishes on the transaction's client (an outbox).
- `queueEventsMemoryCreate(published?)`: records publishes in an array, for unit tests.
- `consumerCreate(queueName, eventName, schema, run)`, `Consumer`: parses each Event with Zod and runs the Consumer.
- `consumersSubscribe(queue, consumers)`: creates the queues and subscriptions; every process that publishes calls it at boot.
- `consumersStart(queue, consumers)`: subscribes, then runs the Consumers (worker only).
- `scheduleCreate(name, cron, run)`, `schedulesRegister(queue, schedules, { env })`, `Schedule`: UTC cron jobs in the worker. `SCHEDULE_<NAME>` overrides a cron, or turns it `off`.
- `queueInboxInsert(pgClient, inbox)`, `Inbox`: records the Event as handled in the caller's transaction; `false` means it was already handled.
- `queueJobRun(queueName, job, work)`: runs one job's work, logs a throw and counts dead letters (`baseline.queue.dead_letters`).
- `queueRetryLimit`: retries before a job moves to `<queueName>.dead` (4, so five attempts).

## Example

```ts
import type { Actor } from "@n8io/baseline-authn";
import {
	consumerCreate,
	consumersStart,
	queueCreate,
	scheduleCreate,
	schedulesRegister,
} from "@n8io/baseline-queue";

// The worker's composition root.
const queue = await queueCreate({ pgPool, role: "worker" });

// Each Consumer calls its Use case as its own machine Actor.
const billingOrderPlacedConsumerActor: Actor = {
	id: "billing-order-placed-consumer",
	kind: "client",
	scopes: ["billing:invoice-create"],
};
const billingOrderPlaced = consumerCreate(
	"billing.order-placed", // queueName: <consumer domain>.<event>
	"order.placed", // eventName
	orderPlaced, // Zod schema
	(event, inbox) =>
		billingUseCases.invoiceCreate(
			billingOrderPlacedConsumerActor,
			{ customerId: event.customerId, amountCents: event.totalCents },
			inbox,
		),
);
await consumersStart(queue, [billingOrderPlaced]);

const fooStaleArchive = scheduleCreate("foo.stale-archive", "0 3 * * *", () =>
	fooUseCases.fooStaleArchive(fooScheduleActor),
);
await schedulesRegister(queue, [fooStaleArchive], { env: ENV });
```

## Needs

- Peers: `pg`, `zod`, `@opentelemetry/api` and, for types, `@types/pg`.
- Env, by the template's convention: `DATABASE_URL`, and an optional `SCHEDULE_<NAME>` per Schedule.

## Tests

`pnpm test` needs Docker: it starts a Postgres container.
