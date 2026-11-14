import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import {
	InvoiceLineForbiddenError,
	InvoiceLineNotFoundError,
} from "../invoice-line-errors.ts";
import { invoiceLineCustomerReaderMemoryCreate } from "../spi/index.ts";
import { invoiceLinePortsMemoryCreate } from "../spi/invoice-line-ports.memory.ts";
import { invoiceLineCreate } from "./invoice-line-create.ts";
import { invoiceLineCustomerAssign } from "./invoice-line-customer-assign.ts";
import { invoiceLineGet } from "./invoice-line-get.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };
const customerId = idCreate("customer");

const setup = async () => {
	const memory = invoiceLinePortsMemoryCreate();
	const ports = {
		...memory.ports,
		invoiceLineCustomerReader: invoiceLineCustomerReaderMemoryCreate([
			{ id: customerId, name: "Acme" },
		]),
	};
	const created = await invoiceLineCreate(ports)(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { ...memory, invoiceLine: created.value, ports };
};

describe("invoiceLineCustomerAssign", () => {
	it("bills the invoice line to a known customer and clears its cache entry", async () => {
		const { ports, state, invoiceLine } = await setup();
		const get = invoiceLineGet(ports);
		await get(owner, { invoiceLineId: invoiceLine.id });

		const result = await invoiceLineCustomerAssign(ports)(owner, {
			customerId,
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual({
			ok: true,
			value: expect.objectContaining({ customerId, id: invoiceLine.id }),
		});
		expect(state.invoiceLines.get(invoiceLine.id)?.customerId).toBe(customerId);
		expect(await get(owner, { invoiceLineId: invoiceLine.id })).toEqual({
			ok: true,
			value: expect.objectContaining({ customerId }),
		});
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
		const { ports } = await setup();
		const result = await invoiceLineCustomerAssign(ports)(owner, {
			customerId,
			invoiceLineId: idCreate("invoice_line"),
		});

		expect(result).toEqual(err(expect.any(InvoiceLineNotFoundError)));
	});

	it("forbids a stranger and changes nothing", async () => {
		const { ports, state, invoiceLine } = await setup();
		const result = await invoiceLineCustomerAssign(ports)(stranger, {
			customerId,
			invoiceLineId: invoiceLine.id,
		});

		expect(result).toEqual(err(expect.any(InvoiceLineForbiddenError)));
		expect(state.invoiceLines.get(invoiceLine.id)).toEqual(invoiceLine);
	});
});
