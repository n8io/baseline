# Events, Bridges and Aggregates

Read when adding a Consumer, an Event, a Bridge or a repository.

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
- Publish an Event only inside the Use case's transaction, through the domain's `<domain>Events` port.
- A Domain whose ids other Domains hold publishes `<entity>.deleted`. Each Domain holding that id consumes it and decides what to do with its rows.

## Bridge

A Bridge fills a Port of the reading Domain by calling another Domain's `*Get` or `*List` Use case with its own machine Actor. Reads only. Never write across Domains. Wire it at `// domain-create: bridges`.

```ts
// billing/ports.ts
export type BillingCustomerReader = {
	get(
		id: Id<"customer">,
	): Promise<{ email: string; taxRegion: string } | undefined>;
};

// src/bridges/billing-customer.ts (the only file that knows both Domains)
const billingCustomerBridgeActor: Actor = {
	id: "billing-customer-bridge",
	kind: "client",
	scopes: [],
};
export const billingCustomerReaderCreate = (
	customer: CustomerUseCases,
): BillingCustomerReader => ({
	get: async (id) => {
		const r = await customer.customerGet(billingCustomerBridgeActor, {
			customerId: id,
		});
		return r.ok
			? { email: r.value.email, taxRegion: r.value.taxRegion }
			: undefined;
	},
});
```

## Aggregate

- One repository per Aggregate root, named after it. Its tables live in `spi/`.
- A supporting Model gets no repository. Save and load it through the root's repository.
- A transaction may change more than one Aggregate, but only within one Domain.
