# Anti-corruption layers and sagas

Read when one bounded context reads another (an anti-corruption layer, ACL), or when a context waits on what another did with its Domain event (a saga). Event handlers, Event keys and shape changes: [events.md](events.md).

## Anti-corruption layer

An ACL reads an upstream context for a downstream one. It lives in the downstream context's `adapters/outbound/<context>-<upstream>-acl.ts`, calls the upstream's interface (its `*Get` or `*List` Use cases) with its own machine Actor, and returns the downstream's own small shape. Reads only. Never write across contexts: a write is a Domain event. It runs in process, so no memory fake stands in for the upstream: tests build the real upstream on memory adapters.

`pnpm context-create <context> --reads <upstream>` writes everything below (the ACL's slot in the ports, the ACL and its test, `upstream` on the context's factories, the test helper and the wiring); you then change what the ACL returns. The code is what it writes in baseline's render test, where invoice lines read a customer's name; a test fails when this page and that code differ.

The downstream context names what it reads, in its own terms, in `application/ports.ts`, and adds it to its ports:

```ts
// src/contexts/invoice-line/application/ports.ts
// What the context reads about a customer, in its own terms: the anti-corruption layer in
// adapters/outbound/invoice-line-customer-acl.ts fills it from the customer context.
export type InvoiceLineCustomerAcl = {
	get(id: Id<"customer">): Promise<{ name: string } | undefined>;
};
```

The ACL is the only file that calls the upstream context, and it imports only its `index.ts`. Every context's `index.ts` exports `<Context>Context`, what its `<context>ContextCreate` returns:

```ts
// src/contexts/invoice-line/adapters/outbound/invoice-line-customer-acl.ts
// What the ACL uses of the customer context's interface.
export type InvoiceLineCustomerUpstream = Pick<CustomerContext, "useCases">;
```

It calls the upstream with its own machine Actor, `invoiceLineCustomerAclActor`, which holds no scope because it only reads:

```ts
// src/contexts/invoice-line/adapters/outbound/invoice-line-customer-acl.ts
// Reads a customer through customerGet and keeps only what invoice line needs of it.
export const invoiceLineCustomerAclCreate = ({
	useCases,
}: InvoiceLineCustomerUpstream): InvoiceLineCustomerAcl => ({
	get: async (id) => {
		const r = await useCases.customerGet(invoiceLineCustomerAclActor, {
			customerId: id,
		});
		return r.ok ? { name: r.value.name } : undefined;
	},
});
```

`<context>PortsCreate` takes the upstream contexts as its second argument, never optional, so a wiring that forgets one does not compile, and builds each ACL from them:

```ts
// src/contexts/invoice-line/adapters/outbound/index.ts
// The contexts this context reads, built before it in src/contexts.ts: each fills its ACL.
export type InvoiceLineUpstream = { customer: InvoiceLineCustomerUpstream };
```

```ts
// src/contexts/invoice-line/adapters/outbound/index.ts
export const invoiceLinePortsCreate = (
	connections: Connections,
	upstream: InvoiceLineUpstream,
): InvoiceLinePorts => {
```

The context's interface takes them as `upstream`, and `contextsCreate` in `src/contexts.ts` passes each upstream context it built first. The Server, the Worker, the seed and page tests all build their contexts there, so no Composition root names an ACL:

```ts
// src/contexts.ts
const invoiceLineContext = invoiceLineContextCreate({
	connections,
	upstream: {
		// Built after customer: it reads customer through an ACL.
		customer: customerContext,
	},
});
```

Tests build the context through `contextsCreate` on memory connections ([tests.md](tests.md)), which builds the real upstream too; a test that needs an upstream row creates it through the upstream's Use cases. A test past the interface (a repository contract test) builds ports with `<context>TestUpstreamCreate` and `<context>PortsMemoryCreate`, which takes the upstream like `<context>PortsCreate` does.

```ts
// src/contexts/invoice-line/application/invoice-line-customer-assign.test.ts
// The real customer context on memory connections holds the customer: no fake stands in for it.
const setup = async () => {
	const { customerContext, invoiceLineContext } = contextsCreate(connections);
	const customer = await customerContext.useCases.customerCreate(owner, {
		name: "Acme",
	});
	if (!customer.ok) throw customer.error;
```

- **Build order.** `contextsCreate` builds a context after every context it reads. Two contexts never read each other: when they would, one of them reacts to the other's Domain events instead. Add the relationship to `CONTEXT-MAP.md` (`| invoice-line | customer | ACL |`).
- **Rules.** Architecture rule A11 fails an ACL that imports anything of another context but its upstream's `index.ts`, or calls an upstream Use case that is not a `*Get` or `*List`. A6 fails any other file that imports another context, except an Event handler (its Domain event schemas) and a seed (an upstream's types). Inside a context only tests and test helpers import `src/contexts.ts` or `src/connections.ts`.
- **Lists.** An ACL that needs every match calls the upstream's `*List` Use case page by page, passing `nextCursor` back until it is `null`, and returns one array. Keep such a read to lists that stay small; a large one is a Projection fed by the upstream's Domain events.
- **Seeds.** A seed that needs upstream rows gets the upstream from `index.ts` and runs after the upstream's seeds: [context-create.md](context-create.md#seeds).
- **Between the read and the commit.** An ACL reads before the downstream context's transaction opens, so the upstream can change in between (the customer is deleted after the check). Pick one, and say which in the Use case's comment: accept it, because an Event handler of the upstream's `<aggregate>.deleted` cleans up; read again after commit and undo; or sweep with a Schedule.

## Saga

When a context acts on another context's Domain event and that context waits on the result (an order waits for billing to approve the customer's credit), the outcome travels back as a Domain event. The contexts take turns, each through an Event handler that calls a Use case: a choreographed saga.

- The acting context's Use case publishes `<aggregate>.<thing>-applied` or `<aggregate>.<thing>-refused` in the same transaction as its write, keyed by the entity the waiting context tracks, and returns `ok` for both.
- A refusal is an outcome, not a failure. An `err` rolls the transaction back, so the inbox row and the `-refused` Domain event go with it, and only a throw is retried: the waiting context would wait for ever.
- Return `err` only for an outcome nobody waits on.
- A Domain event carries what its Event handlers need to act without reading the publisher back, such as the customer id and the amount on an `order.placed`.
- The waiting context has one Event handler per outcome Domain event.
- Inside one context, a change across several Aggregates under one invariant is one transaction, not a saga ([context-create.md](context-create.md)).
