import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { invoiceLinePortsMemoryCreate } from "../adapters/outbound/invoice-line-ports.memory.ts";
import { invoiceLineTestUpstreamCreate } from "../adapters/outbound/invoice-line-test-upstream.ts";
import {
	InvoiceLineForbiddenError,
	InvoiceLineNotFoundError,
} from "../domain/errors.ts";
import { invoiceLineCreate } from "./invoice-line-create.ts";
import { invoiceLineCustomerAssign } from "./invoice-line-customer-assign.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

// The real customer context on memory adapters holds the customer: no fake stands in for it.
const setup = async () => {
	const upstream = await invoiceLineTestUpstreamCreate();
	const customer = await upstream.customer.useCases.customerCreate(owner, {
		name: "Acme",
	});
	if (!customer.ok) throw customer.error;
	const memory = invoiceLinePortsMemoryCreate(upstream);
	const created = await invoiceLineCreate(memory.ports)(owner, {
		name: "alpha",
	});
	if (!created.ok) throw created.error;
	return {
		...memory,
		customerId: customer.value.id,
		invoiceLine: created.value,
	};
};

describe("invoiceLineCustomerAssign", () => {
	it("bills the invoice line to a known customer", async () => {
		const { customerId, ports, state, invoiceLine } = await setup();

		const result = await invoiceLineCustomerAssign(ports)(owner, {
			customerId,
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual({
			ok: true,
			value: expect.objectContaining({ customerId, id: invoiceLine.id }),
		});
		expect(state.invoiceLines.get(invoiceLine.id)?.customerId).toBe(customerId);
	});

	it("answers not found for an unknown customer without opening a transaction", async () => {
		const { ports, state, invoiceLine } = await setup();
		const refused = (() => {
			throw new Error("opened a transaction");
		}) as typeof ports.invoiceLineTransaction;

		const result = await invoiceLineCustomerAssign({
			...ports,
			invoiceLineTransaction: refused,
		})(owner, {
			customerId: idCreate("customer"),
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual(err(expect.any(InvoiceLineNotFoundError)));
		expect(state.invoiceLines.get(invoiceLine.id)?.customerId).toBeUndefined();
	});

	it("answers not found for an unknown invoice line", async () => {
		const { customerId, ports } = await setup();
		const result = await invoiceLineCustomerAssign(ports)(owner, {
			customerId,
			invoiceLineId: idCreate("invoice_line"),
		});

		expect(result).toEqual(err(expect.any(InvoiceLineNotFoundError)));
	});

	it("forbids a stranger and changes nothing", async () => {
		const { customerId, ports, state, invoiceLine } = await setup();
		const result = await invoiceLineCustomerAssign(ports)(stranger, {
			customerId,
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual(err(expect.any(InvoiceLineForbiddenError)));
		expect(state.invoiceLines.get(invoiceLine.id)).toEqual(invoiceLine);
	});
});
