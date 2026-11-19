# Events and Aggregates

Read when adding an Event handler, a Domain event or a repository. A context that reads another through an anti-corruption layer: [acl.md](acl.md).

## Event handler with the inbox

An Event handler lives in the reacting context's `adapters/inbound/`, one file per Domain event, named `<context>-<event>-handler.ts`. The context's `index.ts` lists it in `handlers`, at `// wiring: handlers`: `server.ts` subscribes every context's handlers and only `worker.ts` runs them. Read the other context's schemas inside the `…HandlerCreate` function, never at the top of the file: two contexts that handle each other's Events import each other's `index.ts`, and a top-level read of a binding still in that cycle throws.

```ts
// src/contexts/billing/adapters/inbound/billing-order-placed-handler.ts
import { orderPlaced } from "#contexts/order/index.ts"; // the one allowed cross-context import: Event schemas only
const billingOrderPlacedHandlerActor: Actor = {
	id: "billing-order-placed-handler",
	kind: "client",
	scopes: ["billing:invoice-create"],
};
export const billingOrderPlacedHandlerCreate = (u: BillingUseCases) =>
	queueConsumerCreate({
		queueName: "billing.order-placed",
		eventName: "order.placed",
		schema: orderPlaced,
		run: (event, inbox) =>
			u.invoiceCreate(billingOrderPlacedHandlerActor, {
				amountCents: event.totalCents,
				customerId: event.customerId,
				inbox,
			}),
	});
```

- Delivery is at least once. The Use case takes `inbox` in its input and passes it to its transaction port: `billingTransaction(work, inbox)`.
- The adapter inserts `(consumer, eventId)` into `queue.inbox` in the same transaction. A repeat skips the work and returns `ok`.
- Such a Use case returns `Result<void, E>`.
- Publish an Event only inside the Use case's transaction, through its Aggregate's `<aggregate>Events` port, and after the write it is about.
- A context whose ids other contexts hold publishes `<entity>.deleted`. Each context holding that id handles it: see [Holding another context's id](#holding-another-contexts-id).

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

- Each Event handler gets the Events of one Event key one at a time, in the order their transactions committed, however many workers run. Events with different Event keys run beside each other, so never rely on order across entities.
- The port types `key` as its Aggregate's own id (`Id<"order">`), so a publish without one, or with another Aggregate's id, does not compile.
- While an Event waits for a retry, the later Events of its Event key wait behind it. Keep an Event handler's Use case short, and let it return `err` for an outcome you expect: only a throw is retried.
- An Event that fails all five attempts blocks its Event key until someone releases it, or for 7 days, after which it is deleted and the key moves on with an error log. The worker logs it at error level (error tracking hears it, and again each day), `queue.blockedKeys()` lists it, `queue.blockedKeyRetry({ consumer, key })` or `queue.blockedKeyGiveUp({ consumer, key })` releases it, and in a pod `node src/blocked-keys.ts` does both. The runbook is "A blocked key" in the `@n8io/baseline-queue` README.

### Where order stops

Order holds per Event key and per Event handler. Plan for the three places it does not reach:

- **Across Event keys.** `score.posted` (key: the score) can reach an Event handler before `tournament.started` (key: the tournament) has been handled by another. When an Event handler needs a row another key's Event creates, create it on demand: upsert the row it needs (`INSERT ... ON CONFLICT DO NOTHING`, then read it), and let the later Event fill in the rest. Never wait or retry until the other Event lands: a throw holds this key back through five attempts, then blocks it until someone releases it. Do not return `err` for the missing row either: `err` completes the Event and it never runs again.
- **A redriven Event.** Releasing a blocked key by giving its Event up (`blockedKeyGiveUp`), then redriving the copy from `<queueName>.dead`, runs that Event after the ones that waited behind it (runbook: "A blocked key" in the `@n8io/baseline-queue` README). Retrying it in place (`blockedKeyRetry`) keeps its turn.
- **A stale Event.** Where a late or repeated Event must not undo a newer state, put a version or sequence on the Event (one the publisher keeps on its row, or the source feed's sequence number) and keep the last one applied on the row. The Use case compares it inside its transaction, skips an Event whose version is not newer and returns `ok`. The inbox already skips an exact repeat; the guard covers a redriven or out-of-band one.

## Event handlers that write a shared Aggregate

Two Events with different Event keys run at once, on one worker or several. When both change the same Aggregate (two `score.posted` Events for two golfers of one Team both add to the Team's Standing), both read it, and the second save overwrites the first: points lost under load, with no error.

- Lock the root before reading it, inside the transaction: `findByIdForUpdate(id)` (Drizzle's `.for("update")`). The second Event handler waits for the first to commit, then reads the new state.
- Or make the write one atomic statement (`UPDATE standing SET points = points + $1 WHERE id = $2`), when the change does not depend on what else the row holds.
- One transaction writes one Aggregate. Two of the same context's Aggregates may share one only for an invariant that needs both, named in a `// invariant: <what>` comment above it (A28); across contexts, publish an Event and let the other context react.
- Several roots in one transaction: lock them in id order (`ORDER BY id ... FOR UPDATE`), on every path that locks them, Use cases and Schedules too. Two paths that lock the same rows in different orders deadlock, and Postgres aborts one.
- A race test proves it: force the interleaving with `postgresTestInterleave` (`@n8io/baseline-postgres/testing`) and see the test fail with the lock removed.

## Fan-out in an Event handler

An Event handler that writes many rows for one Event (open a Tournament: one row per Team per golfer):

- Insert and update rows in one order (sorted by id or by the unique key), so two fan-outs over overlapping rows queue up instead of deadlocking. A bulk `UPDATE ... WHERE` locks in scan order: lock with `SELECT ... ORDER BY id FOR UPDATE` first.
- Chunk inserts under Postgres's 65,535 bind parameters per statement (rows × columns): 1,000 rows a statement is a safe start.
- A transaction ends after 5 s (`postgresTransactionRun`'s `timeoutMs`), and the Event retries from scratch. When the work can outgrow that, split it into several transactions in one run: each writes one chunk and is safe to repeat (an upsert, or skip what is there), and only the last takes the inbox. A retry then redoes only what is missing. Keep the whole run well under the queue's five-minute limit.

## Holding another context's id

A table column that holds another context's id ships with the Event handler that cleans it up, in the same PR. Architecture rule A14 fails the check otherwise: a table in `src/contexts/<context>/adapters/outbound/` with a `<other>` id column needs `src/contexts/<context>/adapters/inbound/<context>-<other>-deleted-handler.ts` handling `"<other>.deleted"`. So when you land tables first, land these Event handlers and their Use cases with them.

The repository side is one bulk method per clean-up, repeated in the memory adapter and held equal by `adapters/outbound/<aggregate>-repository.contract.ts`:

- Rows that cannot live without the other entity: `deleteByTeamId(teamId)` deletes them and returns the ids it removed, sorted, so the Use case can publish `<entity>.deleted` for each, in the same transaction and in id order (each publish locks its Event key until the transaction ends, so two clean-ups publishing in different orders deadlock).
- Rows that can: `clearByTeamId(teamId)` sets the column to null (or removes the child rows) and returns the ids of the roots it touched, so the Use case can recompute or notify them.

With an inbox the transaction returns `Result<void, E>`, so a value the Use case needs after commit (ids for live updates) goes in a `let` that the work assigns, read only when the result is ok. A repeat skips the work and leaves it empty, so nothing is sent twice.

## Testing an Event handler

Run the Event handler as the worker does, through the context's interface on memory connections ([tests.md](tests.md)), with `queueTestConsumerRun` from `@n8io/baseline-queue/testing`:

```ts
// src/contexts/billing/adapters/inbound/billing-order-placed-handler.test.ts
const { handlers, useCases } = contextsCreate(connections).billingContext;
const consumer = handlers.find((each) => each.eventName === "order.placed");
if (!consumer) throw new Error("no order.placed handler");
const result = await queueTestConsumerRun({
	consumer,
	data: { customerId, orderId, totalCents: 1200 },
});
expect(result).toEqual(ok(undefined));
expect(await useCases.invoiceList(actor, { orderId })).toMatchObject({
	ok: true,
	value: [{ amountCents: 1200 }],
});
```

- It validates `data` as the worker does, so pass the whole Event as the publisher sends it; a missing field rejects ("Event failed validation for ...").
- Pass the same `eventId` twice to check a repeat changes nothing.
- Assert on what a later read returns, not on calls or memory state. No mocks.

## Changing an Event's shape

During a rollout, workers of the old release and the new one run side by side for minutes, and an Event published by one may reach the other. An Event also keeps its shape for as long as it waits: through its retries, then up to 7 days as a blocked key. A worker that rejects the shape retries it five times and then blocks its Event key, and every later Event of that entity waits behind it.

Event handlers validate with the definition the publishing context exports (`#contexts/<publisher>/index.ts`), so widening is one edit there. The Template defines Events with Zod `z.object`, which drops keys it does not know. Never use `.strict()` or `z.strictObject` for an Event: an old worker would then reject every new field.

**One release** is enough to add an optional field that an old worker may ignore. An old worker drops it; a new worker reads it as absent on Events published before the release.

**Three releases** for a required field, a rename, a type change or a removal, the way `data.md` changes a table:

1. **Widen.** Release Event handlers that accept both shapes: the new field is optional, or the old one is still read. Publish the old shape still.
2. **Switch.** In the next release, publish the new shape. Every worker already accepts it.
3. **Narrow.** One release later, stop accepting the old shape, but only when no Event of the old shape is left:
   - no blocked keys (`queue.blockedKeys()` is empty);
   - nothing waiting in any Event handler's queue of the Event (`SELECT count(*) FROM queue.job WHERE name = 'billing.order-placed.ordered' AND state IN ('created', 'retry', 'active')` is 0 for each);
   - every publisher (Server, Worker, Schedules, scripts) is on the switch release;
   - no copy in `<queueName>.dead` from before the switch will be redriven (or keep accepting the old shape until those are gone).

Test the widen step with one test that runs both shapes through the Event handler with `queueTestConsumerRun`.

Never rename an Event or remove a required field in one release. A new Event with a new name needs no steps: no old Event handler is subscribed to it.

## Naming beside Events

- A change with no Event still names its analytics event as an Event would be named, `<entity>.<past-tense verb>` (`team.renamed`), and a machine Actor tracks with its Actor id (`billing-order-placed-handler`).
- A live channel is named after the Aggregate that sends it. When the UI watches another context's entity (the Standings of one League), the channel keeps its own name and its `id` is that entity's id; the live route checks the Actor can read that entity.

## Aggregate

- One repository per Aggregate root, named after it. Its tables live in `adapters/outbound/`.
- An entity or value object inside an Aggregate gets no repository. Save and load it through the root's repository.
- A transaction may change more than one Aggregate only within one context, under a `// invariant:` comment (above).
