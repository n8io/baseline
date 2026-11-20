# Ports to outside services

Read when a context needs something outside itself that is not Postgres, the cache, Live updates or another context: send an email, charge a card, call a partner's API, store a file. Postgres goes through repositories ([data.md](data.md)), another context through an ACL ([acl.md](acl.md)).

A Use case never sees the vendor. It calls a port in the context's own words, the composition root opens the vendor's client once, and an outbound adapter joins the two. The analytics port is the model: `analyticsOpen` in `src/analytics-open.ts`, `connections.analytics`, and the context's `<context>Analytics` port.

## Steps

1. **The port.** Add its type to `<Context>Ports` in `application/ports.ts`, above `// wiring: ports`, named `<context><Thing>` (`invoiceMailer`). Its methods take and return the context's types and ids, never a vendor type, and declare no `close` (A12). Say on it whether it throws.
2. **The connection.** Open the vendor's client in a new `src/<thing>-open.ts` (`mailerOpen({ steps, url })`), called from `connectionsOpen` in `src/connections.ts`, which returns it on `Connections` and pushes its close onto `resources`. Only `src/connections.ts` and the `src/*-open.ts` files build a vendor client; A12 checks the Packages' factories, so add the new client's constructor to its pattern. Its URL or token goes in `.env.schema`; for an empty value or `memory://` the open function returns a stand-in instead (a logger or an in-memory list), as `analyticsOpen` does without a token, so development and every unit test run with no account.
3. **The adapter.** `<context>PortsCreate` in `adapters/outbound/index.ts` maps the port onto `connections.<thing>`; past a few lines, the mapping goes in its own `adapters/outbound/<context>-<thing>.ts`. `<context>PortsMemoryCreate` in `<context>-ports.memory.ts` lists the port too, with a stand-in.
4. **The call.** A Use case calls the port after its transaction commits, never inside it (AGENTS.md, "Rules no tool checks"), and treats a failure as its port says.
5. **The test.** Context tests build the context on memory connections ([tests.md](tests.md)), so they get the stand-in; to see what was sent, spread a recording double into `connections.<thing>` ([tests.md](tests.md)). A test of the real client needs its service and goes in `test/integration/`.
6. **The dependency.** A new vendor library is a stop-and-ask with a line in `dependencies-allowed.json` ([dependency-updates.md](dependency-updates.md)). A vendor-only setting goes through [vendor-settings.md](vendor-settings.md).

```ts
// application/ports.ts
invoiceMailer: {
	// Throws when the mail service refuses the message.
	send(mail: { to: Id<"customer">; template: "invoice.sent" }): Promise<void>;
};
```
