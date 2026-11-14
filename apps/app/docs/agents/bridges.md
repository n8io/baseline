# Bridges and Outcome Events

Read when one Domain reads another (a Bridge), or when a Domain waits on what another Domain did with its Event (Outcome Events). Consumers, Event keys and shape changes: [events.md](events.md).

## Bridge

A Bridge fills a reader port of the reading Domain by calling another Domain's `*Get` or `*List` Use case with its own machine Actor. Reads only. Never write across Domains: a write is an Event. `pnpm domain-create <name> --reads <target>` writes everything below (the reader port, the readers argument, the memory fake, the Bridge and its test, and the wiring); you then change what the reader returns. The code is what it writes in baseline's render test, where invoice lines read a customer's name; a test fails when this page and that code differ.

The reading Domain declares the reader in `ports.ts`, adds it to its ports, and names the ports Bridges fill:

```ts
// src/domains/invoice-line/ports.ts
// What invoice lines read about a customer. The Bridge in
// src/bridges/invoice-line-customer-reader.ts fills it from the customer Domain.
export type InvoiceLineCustomerReader = {
	get(id: Id<"customer">): Promise<{ name: string } | undefined>;
};
```

```ts
// src/domains/invoice-line/ports.ts
// The ports Bridges fill: the second argument of invoiceLinePortsCreate.
export type InvoiceLineReaders = Pick<
	InvoiceLinePorts,
	"invoiceLineCustomerReader"
>;
```

`<domain>PortsCreate` takes the readers as its second argument, never optional, so a wiring that forgets a Bridge does not compile:

```ts
// src/domains/invoice-line/spi/index.ts
export const invoiceLinePortsCreate = (
	connections: Connections,
	readers: InvoiceLineReaders,
): InvoiceLinePorts => {
```

The Bridge is the only file that knows both Domains. It lives in `src/bridges/`, named after its export, `<domain>-<target>-reader.ts`:

```ts
// src/bridges/invoice-line-customer-reader.ts
// The Bridge's own machine Actor: it only reads, so it holds no scope.
const invoiceLineCustomerReaderActor: Actor = {
	id: "invoice-line-customer-reader",
	kind: "client",
	scopes: [],
};

// The only file that knows both Domains: invoice lines read a customer through customerGet.
export const invoiceLineCustomerReaderCreate = (
	customer: Pick<CustomerUseCases, "customerGet">,
): InvoiceLineCustomerReader => ({
	get: async (id) => {
		const r = await customer.customerGet(invoiceLineCustomerReaderActor, {
			customerId: id,
		});
		return r.ok ? { name: r.value.name } : undefined;
	},
});
```

Wire it once, in `domainsUseCasesCreate` in `src/use-cases.ts`. The Server, the Worker, the seed and page tests all build their Use cases there, so no Composition root names a Bridge:

```ts
// src/use-cases.ts
const invoiceLineUseCases = telemetryUseCasesTrace(
	invoiceLineUseCasesCreate(
		invoiceLinePortsCreate(connections, {
			// Built after customer: this Bridge reads its Use cases.
			invoiceLineCustomerReader:
				invoiceLineCustomerReaderCreate(customerUseCases),
		}),
	),
);
```

The reading Domain's tests use a memory fake of the reader, `<domain><Target>ReaderMemoryCreate`, exported from its `spi/index.ts`. Its memory ports use it too:

```ts
// src/domains/invoice-line/spi/invoice-line-customer-reader.memory.ts
// The customer reader's fake for tests: it knows only the entries it is given.
export const invoiceLineCustomerReaderMemoryCreate = (
	entries: { id: Id<"customer">; name: string }[] = [],
): InvoiceLineCustomerReader => ({
	get: async (id) => {
		const entry = entries.find((e) => e.id === id);
		return entry === undefined ? undefined : { name: entry.name };
	},
});
```

The Bridge's own test runs it on the target Domain's Use cases over memory ports, never on a mock:

```ts
// src/bridges/invoice-line-customer-reader.test.ts
it("reads a customer's name through customerGet", async () => {
	const customer = domainsUseCasesCreate(connections).customerUseCases;
	const created = await customer.customerCreate(owner, { name: "Acme" });
	if (!created.ok) throw created.error;

	const reader = invoiceLineCustomerReaderCreate(customer);

	expect(await reader.get(created.value.id)).toEqual({ name: "Acme" });
});
```

- **Build order.** `domainsUseCasesCreate` builds a Domain after every Domain it reads. Two Domains never read each other: when they would, one of them reacts to the other's Event instead.
- **Lists.** A reader that needs every match calls the target's `*List` Use case page by page, passing `nextCursor` back until it is `null`, and returns one array. Keep such a read to lists that stay small; a large one is an Event-fed copy in the reading Domain.
- **Between the read and the commit.** A Bridge reads before the reading Domain's transaction opens, so the target can change in between (the customer is deleted after the check). Pick one, and say which in the Use case's comment: accept it, because a Consumer of the target's `<entity>.deleted` Event cleans up; read again after commit and undo; or sweep with a Schedule.

## Outcome Events

When a Domain acts on another Domain's Event and that Domain waits on the result (a Trade waits for the Team to swap its golfers), the outcome travels back as an Event.

- The acting Domain's Use case publishes `<domain>.<thing>-applied` or `<domain>.<thing>-refused` in the same transaction as its write, keyed by the entity the waiting Domain tracks, and returns `ok` for both.
- A refusal is an outcome, not a failure. An `err` rolls the transaction back, so the inbox row and the `-refused` Event go with it, and only a throw is retried: the waiting Domain would wait for ever.
- Return `err` only for an outcome nobody waits on.
- An Event carries what its Consumers need to act without reading the publisher back, such as both golfer ids on a `trade.accepted`.
- The waiting Domain has one Consumer per outcome Event.
