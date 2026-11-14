import type { Actor } from "@n8io/baseline-authn";
import type { CustomerUseCases } from "#domains/customer/index.ts";
import type { InvoiceLineCustomerReader } from "#domains/invoice-line/index.ts";

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
