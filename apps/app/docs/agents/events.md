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
- A Domain whose ids other Domains hold publishes `<entity>.deleted`. Each Domain holding that id consumes it and decides what to do with its rows.

## Order and the Event key

Every publish names an Event key, the id of the entity the Event is about:

```ts
await transaction.orderEvents.publish({
	name: "order.placed",
	data: { orderId: order.id, totalCents: order.totalCents },
	key: order.id,
});
```

- Each Consumer gets the Events of one Event key one at a time, in the order their transactions committed, however many workers run. Events with different Event keys run beside each other, so never rely on order across entities.
- The port types `key` as the Domain's own id (`Id<"order">`), so a publish without one, or with another Domain's id, does not compile.
- While an Event waits for a retry, the later Events of its Event key wait behind it. Keep a Consumer's Use case short, and let it return `err` for an outcome you expect: only a throw is retried.
- An Event that fails all five attempts blocks its Event key until someone releases it, or for 7 days, after which it is deleted and the key moves on. The worker logs it at error level, `queue.blockedKeys()` lists it, and the runbook is "A blocked key" in the `@n8io/baseline-queue` README.

## Changing an Event's shape

During a rollout, workers of the old release and the new one run side by side for minutes, and an Event published by one may reach the other. A worker that rejects the shape retries it five times and then blocks its Event key. So change a shape in three releases, the way `data.md` changes a table:

1. **Widen.** Release Consumers that accept both shapes: the new field is optional, or the old one is still read. Publish the old shape still.
2. **Switch.** In the next release, publish the new shape. Every worker already accepts it.
3. **Narrow.** One release later, stop accepting the old shape.

Never rename an Event or remove a required field in one release. A new Event with a new name needs no steps: no old Consumer is subscribed to it.

## Aggregate

- One repository per Aggregate root, named after it. Its tables live in `spi/`.
- A supporting Model gets no repository. Save and load it through the root's repository.
- A transaction may change more than one Aggregate, but only within one Domain.
