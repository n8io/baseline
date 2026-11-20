import type { Actor } from "@n8io/baseline-authn";
import type { Id } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const handler: Actor = {
	id: "invoice-line-customer-deleted-handler",
	kind: "client",
	scopes: [],
};
const connections = await connectionsOpen({ role: "publisher" });

// Two customers in the real customer context on memory connections: one deleted, one kept.
const setup = async () => {
	const { customerContext, invoiceLineContext } = contextsCreate(connections);
	const { useCases } = invoiceLineContext;
	const customerAdd = async (name: string) => {
		const customer = await customerContext.useCases.customerCreate(owner, {
			name,
		});
		if (!customer.ok) throw customer.error;
		return customer.value.id;
	};
	const deleted = await customerAdd("Acme");
	const kept = await customerAdd("Globex");
	const billed = async (name: string, customerId: Id<"customer">) => {
		const created = await useCases.invoiceLineCreate(owner, { name });
		if (!created.ok) throw created.error;
		const assigned = await useCases.invoiceLineCustomerAssign(owner, {
			customerId,
			invoiceLineId: created.value.id,
		});
		if (!assigned.ok) throw assigned.error;
		return created.value.id;
	};
	const customerIdOf = async (invoiceLineId: Id<"invoice_line">) => {
		const line = await useCases.invoiceLineGet(owner, { invoiceLineId });
		if (!line.ok) throw line.error;
		return line.value.customerId;
	};
	return { billed, customerIdOf, deleted, kept, useCases };
};

describe("invoiceLineCustomerClear", () => {
	it("removes the deleted customer from its invoice lines only", async () => {
		const { billed, customerIdOf, deleted, kept, useCases } = await setup();
		const first = await billed("alpha", deleted);
		const other = await billed("beta", kept);

		const result = await useCases.invoiceLineCustomerClear(handler, {
			customerId: deleted,
			inbox: { consumer: "invoice-line.customer-deleted", eventId: "event-1" },
		});

		expect(result).toEqual({ ok: true, value: undefined });
		expect(await customerIdOf(first)).toBeUndefined();
		expect(await customerIdOf(other)).toBe(kept);
	});

	it("skips a repeated event: the inbox already holds it", async () => {
		const { billed, customerIdOf, deleted, useCases } = await setup();
		const inbox = {
			consumer: "invoice-line.customer-deleted",
			eventId: "event-1",
		};
		await useCases.invoiceLineCustomerClear(handler, {
			customerId: deleted,
			inbox,
		});
		const later = await billed("gamma", deleted);

		const repeat = await useCases.invoiceLineCustomerClear(handler, {
			customerId: deleted,
			inbox,
		});

		expect(repeat).toEqual({ ok: true, value: undefined });
		expect(await customerIdOf(later)).toBe(deleted);
	});
});
