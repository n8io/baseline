import type { Actor } from "@n8io/baseline-authn";
import type { CustomerUseCases } from "#domains/customer/index.ts";
import type { InvoiceLineCustomerReader } from "#domains/invoice-line/index.ts";

const invoiceLineCustomerBridgeActor: Actor = {
	id: "invoice-line-customer-bridge",
	kind: "client",
	scopes: [],
};

// The only file that knows both domains: invoice lines read customers through customerGet.
export const invoiceLineCustomerReaderCreate = (
	customer: Pick<CustomerUseCases, "customerGet">,
): InvoiceLineCustomerReader => ({
	get: async (id) => {
		const r = await customer.customerGet(invoiceLineCustomerBridgeActor, {
			customerId: id,
		});
		return r.ok ? { name: r.value.name } : undefined;
	},
});
