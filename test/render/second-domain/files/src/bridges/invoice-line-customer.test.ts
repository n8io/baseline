import { idCreate } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it, vi } from "vitest";
import { Customer, CustomerNotFoundError } from "#domains/customer/index.ts";
import { invoiceLineCustomerReader } from "./invoice-line-customer.ts";

describe("invoiceLineCustomerReader", () => {
	const customer = Customer.parse({
		archivedAt: null,
		createdAt: new Date(),
		createdBy: "u1",
		id: idCreate("customer"),
		name: "Acme",
		updatedAt: new Date(),
	});

	it("reads a customer's name through customerGet as the bridge's actor", async () => {
		const customerGet = vi.fn(async () => ok(customer));
		const reader = invoiceLineCustomerReader({ customerGet });

		expect(await reader.get(customer.id)).toEqual({ name: "Acme" });
		expect(customerGet).toHaveBeenCalledWith(
			{ id: "invoice-line-customer-bridge", kind: "client", scopes: [] },
			{ customerId: customer.id },
		);
	});

	it("answers undefined for a customer that does not exist", async () => {
		const reader = invoiceLineCustomerReader({
			customerGet: async (_actor, input) =>
				err(new CustomerNotFoundError(input.customerId)),
		});

		expect(await reader.get(customer.id)).toBeUndefined();
	});
});
