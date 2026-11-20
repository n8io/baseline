import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";
import {
	InvoiceLineForbiddenError,
	InvoiceLineNotFoundError,
} from "../domain/errors.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

// The real customer context on memory connections holds the customer: no fake stands in for it.
const setup = async () => {
	const { customerContext, invoiceLineContext } = contextsCreate(connections);
	const customer = await customerContext.useCases.customerCreate(owner, {
		name: "Acme",
	});
	if (!customer.ok) throw customer.error;
	const { useCases } = invoiceLineContext;
	const created = await useCases.invoiceLineCreate(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return {
		customerId: customer.value.id,
		invoiceLine: created.value,
		useCases,
	};
};

describe("invoiceLineCustomerAssign", () => {
	it("bills the invoice line to a known customer", async () => {
		const { customerId, invoiceLine, useCases } = await setup();

		const result = await useCases.invoiceLineCustomerAssign(owner, {
			customerId,
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual({
			ok: true,
			value: expect.objectContaining({ customerId, id: invoiceLine.id }),
		});
		expect(
			await useCases.invoiceLineGet(owner, { invoiceLineId: invoiceLine.id }),
		).toEqual({ ok: true, value: expect.objectContaining({ customerId }) });
	});

	it("answers not found for an unknown customer and changes nothing", async () => {
		const { invoiceLine, useCases } = await setup();

		const result = await useCases.invoiceLineCustomerAssign(owner, {
			customerId: idCreate("customer"),
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual(err(expect.any(InvoiceLineNotFoundError)));
		expect(
			await useCases.invoiceLineGet(owner, { invoiceLineId: invoiceLine.id }),
		).toEqual({ ok: true, value: invoiceLine });
	});

	it("answers not found for an unknown invoice line", async () => {
		const { customerId, useCases } = await setup();

		const result = await useCases.invoiceLineCustomerAssign(owner, {
			customerId,
			invoiceLineId: idCreate("invoice_line"),
		});

		expect(result).toEqual(err(expect.any(InvoiceLineNotFoundError)));
	});

	it("forbids a stranger and changes nothing", async () => {
		const { customerId, invoiceLine, useCases } = await setup();

		const result = await useCases.invoiceLineCustomerAssign(stranger, {
			customerId,
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual(err(expect.any(InvoiceLineForbiddenError)));
		expect(
			await useCases.invoiceLineGet(owner, { invoiceLineId: invoiceLine.id }),
		).toEqual({ ok: true, value: invoiceLine });
	});
});
