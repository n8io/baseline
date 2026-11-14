# Events and Aggregates

Read when adding a Consumer, an Event or a repository. A Domain that reads another through a Bridge: [bridges.md](bridges.md).

## Consumer with the inbox

A Consumer lives in the reacting Domain's `api/`, one file per Event. It is subscribed in `server.ts` and `worker.ts` and runs only in `worker.ts`. Wire it at `// domain-create: consumers`.

```ts
// src/domains/billing/api/billing-order-placed-consumer.ts
import { orderPlaced } from "#domains/order/index.ts"; // the one allowed cross-domain import: Event schemas only
const billingOrderPlacedConsumerActor: Actor = {
	id: "billing-order-placed-consumer",
	kind: "client",
	scopes: ["billing:invoice-create"],
};
export const billingOrderPlacedConsumerCreate = (u: BillingUseCases) =>
	queueConsumerCreate({
		queueName: "billing.order-placed",
		eventName: "order.placed",
		schema: orderPlaced,
		run: (event, inbox) =>
			u.invoiceCreate(billingOrderPlacedConsumerActor, {
				amountCents: event.totalCents,
				customerId: event.customerId,
				inbox,
			}),
	});
```

- Delivery is at least once. The Use case takes `inbox` in its input and passes it to its transaction port: `billingTransaction(work, inbox)`.
- The adapter inserts `(consumer, eventId)` into `queue.inbox` in the same transaction. A repeat skips the work and returns `ok`.
- Such a Use case returns `Result<void, E>`.
- Publish an Event only inside the Use case's transaction, through the domain's `<domain>Events` port, and after the write it is about.
- A Domain whose ids other Domains hold publishes `<entity>.deleted`. Each Domain holding that id consumes it: see [Holding another Domain's id](#holding-another-domains-id).

## Order and the Event key

Every publish names an Event key, the id of the entity the Event is about:

```ts
await transaction.orderEvents.publish({
	name: "order.placed",
	data: {
		customerId: order.customerId,
		orderId: order.id,
		totalCents: order.totalCents,
	},
	key: order.id,
});
```

- Each Consumer gets the Events of one Event key one at a time, in the order their transactions committed, however many workers run. Events with different Event keys run beside each other, so never rely on order across entities.
- The port types `key` as the Domain's own id (`Id<"order">`), so a publish without one, or with another Domain's id, does not compile.
- While an Event waits for a retry, the later Events of its Event key wait behind it. Keep a Consumer's Use case short, and let it return `err` for an outcome you expect: only a throw is retried.
- An Event that fails all five attempts blocks its Event key until someone releases it, or for 7 days, after which it is deleted and the key moves on. The worker logs it at error level, `queue.blockedKeys()` lists it, and the runbook is "A blocked key" in the `@n8io/baseline-queue` README.

### Where order stops

Order holds per Event key and per Consumer. Plan for the three places it does not reach:

- **Across Event keys.** `score.posted` (key: the score) can reach a Consumer before `tournament.started` (key: the tournament) has been handled by another. When a Consumer needs a row another key's Event creates, create it on demand: upsert the row it needs (`INSERT ... ON CONFLICT DO NOTHING`, then read it), and let the later Event fill in the rest. Never wait or retry until the other Event lands: a throw holds this key back through five attempts, then blocks it until someone releases it. Do not return `err` for the missing row either: `err` completes the Event and it never runs again.
- **A redriven Event.** Releasing a blocked key by giving its Event up, then redriving the copy from `<queueName>.dead`, runs that Event after the ones that waited behind it (runbook: "A blocked key" in the `@n8io/baseline-queue` README). Retrying it in place keeps its turn.
- **A stale Event.** Where a late or repeated Event must not undo a newer state, put a version or sequence on the Event (one the publisher keeps on its row, or the source feed's sequence number) and keep the last one applied on the row. The Use case compares it inside its transaction, skips an Event whose version is not newer and returns `ok`. The inbox already skips an exact repeat; the guard covers a redriven or out-of-band one.

## Consumers that write a shared Aggregate

Two Events with different Event keys run at once, on one worker or several. When both change the same Aggregate (two `score.posted` Events for two golfers of one Team both add to the Team's Standing), both read it, and the second save overwrites the first: points lost under load, with no error.

- Lock the root before reading it, inside the transaction: `findByIdForUpdate(id)` (Drizzle's `.for("update")`). The second Consumer waits for the first to commit, then reads the new state.
- Or make the write one atomic statement (`UPDATE standing SET points = points + $1 WHERE id = $2`), when the change does not depend on what else the row holds.
- Several roots in one transaction: lock them in id order (`ORDER BY id ... FOR UPDATE`), on every path that locks them, Use cases and Schedules too. Two paths that lock the same rows in different orders deadlock, and Postgres aborts one.
- A race test proves it: force the interleaving with `postgresTestInterleave` (`@n8io/baseline-postgres/testing`) and see the test fail with the lock removed.

## Fan-out in a Consumer

A Consumer that writes many rows for one Event (open a Tournament: one row per Team per golfer):

- Insert and update rows in one order (sorted by id or by the unique key), so two fan-outs over overlapping rows queue up instead of deadlocking. A bulk `UPDATE ... WHERE` locks in scan order: lock with `SELECT ... ORDER BY id FOR UPDATE` first.
- Chunk inserts under Postgres's 65,535 bind parameters per statement (rows × columns): 1,000 rows a statement is a safe start.
- A transaction ends after 5 s (`postgresTransactionRun`'s `timeoutMs`), and the Event retries from scratch. When the work can outgrow that, split it into several transactions in one run: each writes one chunk and is safe to repeat (an upsert, or skip what is there), and only the last takes the inbox. A retry then redoes only what is missing. Keep the whole run well under the queue's five-minute limit.

## Holding another Domain's id

A table column that holds another Domain's id ships with the Consumer that cleans it up, in the same PR. Rule A14 fails the check otherwise: a table in `src/domains/<domain>/spi/` with a `<other>` id column needs `src/domains/<domain>/api/<domain>-<other>-deleted-consumer.ts` consuming `"<other>.deleted"`. So when you land tables first, land these Consumers and their Use cases with them.

The repository side is one bulk method per clean-up, repeated in the memory adapter and held equal by `spi/<domain>-repository.contract.ts`:

- Rows that cannot live without the other entity: `deleteByTeamId(teamId)` deletes them and returns the ids it removed, sorted, so the Use case can publish `<entity>.deleted` for each, in the same transaction and in id order (each publish locks its Event key until the transaction ends, so two clean-ups publishing in different orders deadlock).
- Rows that can: `clearByTeamId(teamId)` sets the column to null (or removes the child rows) and returns the ids of the roots it touched, so the Use case can recompute or notify them.

With an inbox the transaction returns `Result<void, E>`, so a value the Use case needs after commit (ids for live updates) goes in a `let` that the work assigns, read only when the result is ok. A repeat skips the work and leaves it empty, so nothing is sent twice.

## Testing a Consumer

Run the Consumer as the worker does, on memory ports, with `queueTestConsumerRun` from `@n8io/baseline-queue/testing`:

```ts
// src/domains/billing/api/billing-order-placed-consumer.test.ts
const { ports, state } = billingPortsMemoryCreate();
const consumer = billingOrderPlacedConsumerCreate(billingUseCasesCreate(ports));
const result = await queueTestConsumerRun({
	consumer,
	data: { customerId, orderId, totalCents: 1200 },
});
expect(result).toEqual(ok(undefined));
expect([...state.invoices.values()]).toMatchObject([{ amountCents: 1200 }]);
```

- It validates `data` as the worker does, so pass the whole Event as the publisher sends it; a missing field rejects ("Event failed validation for ...").
- Pass the same `eventId` twice to check a repeat changes nothing.
- Assert on what the memory state holds afterwards, not on calls. No mocks.

## Changing an Event's shape

During a rollout, workers of the old release and the new one run side by side for minutes, and an Event published by one may reach the other. An Event also keeps its shape for as long as it waits: through its retries, then up to 7 days as a blocked key. A worker that rejects the shape retries it five times and then blocks its Event key, and every later Event of that entity waits behind it.

Consumers validate with the definition the publishing Domain exports (`#domains/<publisher>/index.ts`), so widening is one edit there. The Template defines Events with Zod `z.object`, which drops keys it does not know. Never use `.strict()` or `z.strictObject` for an Event: an old worker would then reject every new field.

**One release** is enough to add an optional field that an old worker may ignore. An old worker drops it; a new worker reads it as absent on Events published before the release.

**Three releases** for a required field, a rename, a type change or a removal, the way `data.md` changes a table:

1. **Widen.** Release Consumers that accept both shapes: the new field is optional, or the old one is still read. Publish the old shape still.
2. **Switch.** In the next release, publish the new shape. Every worker already accepts it.
3. **Narrow.** One release later, stop accepting the old shape, but only when no Event of the old shape is left:
   - no blocked keys (`queue.blockedKeys()` is empty);
   - nothing waiting in any Consumer queue of the Event (`SELECT count(*) FROM queue.job WHERE name = 'billing.order-placed.ordered' AND state IN ('created', 'retry', 'active')` is 0 for each);
   - every publisher (Server, Worker, Schedules, scripts) is on the switch release;
   - no copy in `<queueName>.dead` from before the switch will be redriven (or keep accepting the old shape until those are gone).

Test the widen step with one test that runs both shapes through the Consumer with `queueTestConsumerRun`.

Never rename an Event or remove a required field in one release. A new Event with a new name needs no steps: no old Consumer is subscribed to it.

## Naming beside Events

- A change with no Event still names its analytics event as an Event would be named, `<entity>.<past-tense verb>` (`team.renamed`), and a machine Actor tracks with its Actor id (`billing-order-placed-consumer`).
- A live channel is named after the Domain that sends it. When the UI watches another Domain's entity (the Standings of one League), the channel keeps its own name and its `id` is that entity's id; the live route checks the Actor can read that entity.

## Aggregate

- One repository per Aggregate root, named after it. Its tables live in `spi/`.
- A supporting Model gets no repository. Save and load it through the root's repository.
- A transaction may change more than one Aggregate, but only within one Domain.
