import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { customerUseCasesCreate } from "#domains/customer/index.ts";
import { customerPortsCreate } from "#domains/customer/spi/index.ts";
import { connectionsOpen } from "../connections.ts";
import { invoiceLineCustomerReaderCreate } from "./invoice-line-customer-reader.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
// Tests run on a memory database, so these are the customer Domain's memory ports.
const connections = await connectionsOpen({ role: "publisher" });

describe("invoiceLineCustomerReaderCreate", () => {
	it("reads a customer's name through customerGet", async () => {
		const customer = customerUseCasesCreate(customerPortsCreate(connections));
		const created = await customer.customerCreate(owner, { name: "Acme" });
		if (!created.ok) throw created.error;

		const reader = invoiceLineCustomerReaderCreate(customer);

		expect(await reader.get(created.value.id)).toEqual({ name: "Acme" });
	});

	it("answers undefined for a customer that does not exist", async () => {
		const customer = customerUseCasesCreate(customerPortsCreate(connections));

		const reader = invoiceLineCustomerReaderCreate(customer);

		expect(await reader.get(idCreate("customer"))).toBeUndefined();
	});
});
