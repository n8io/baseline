import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { invoiceLinePortsMemoryCreate } from "../spi/invoice-line-ports.memory.ts";
import { invoiceLineCreate } from "./invoice-line-create.ts";
import { invoiceLineCustomerAssign } from "./invoice-line-customer-assign.ts";
import { invoiceLineCustomerClear } from "./invoice-line-customer-clear.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const consumer: Actor = {
	id: "invoice-line-customer-deleted-consumer",
	kind: "client",
	scopes: [],
};
const deleted = idCreate("customer");
const kept = idCreate("customer");

const setup = async () => {
	const memory = invoiceLinePortsMemoryCreate();
	const ports = {
		...memory.ports,
		invoiceLineCustomerReader: { get: async () => ({ name: "Acme" }) },
	};
	const billed = async (name: string, customerId: typeof deleted) => {
		const created = await invoiceLineCreate(ports)(owner, { name });
		if (!created.ok) throw created.error;
		const assigned = await invoiceLineCustomerAssign(ports)(owner, {
			customerId,
			invoiceLineId: created.value.id,
		});
		if (!assigned.ok) throw assigned.error;
		return created.value.id;
	};
	return { ...memory, billed, ports };
};

describe("invoiceLineCustomerClear", () => {
	it("removes the deleted customer from its invoice lines only", async () => {
		const { billed, ports, state } = await setup();
		const first = await billed("alpha", deleted);
		const other = await billed("beta", kept);

		const result = await invoiceLineCustomerClear(ports)(consumer, {
			customerId: deleted,
			inbox: { consumer: "invoice-line.customer-deleted", eventId: "event-1" },
		});

		expect(result).toEqual({ ok: true, value: undefined });
		expect(state.invoiceLines.get(first)?.customerId).toBeUndefined();
		expect(state.invoiceLines.get(other)?.customerId).toBe(kept);
	});

	it("skips a repeated event: the inbox already holds it", async () => {
		const { billed, ports, state } = await setup();
		const inbox = {
			consumer: "invoice-line.customer-deleted",
			eventId: "event-1",
		};
		await invoiceLineCustomerClear(ports)(consumer, {
			customerId: deleted,
			inbox,
		});
		const later = await billed("gamma", deleted);

		const repeat = await invoiceLineCustomerClear(ports)(consumer, {
			customerId: deleted,
			inbox,
		});

		expect(repeat).toEqual({ ok: true, value: undefined });
		expect(state.invoiceLines.get(later)?.customerId).toBe(deleted);
	});
});
