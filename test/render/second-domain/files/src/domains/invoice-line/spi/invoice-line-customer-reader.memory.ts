import type { Id } from "@n8io/baseline-id";
import type { InvoiceLineCustomerReader } from "../ports.ts";

// The customer reader's fake for tests: it knows only the customers it is given.
export const invoiceLineCustomerReaderMemoryCreate = (
	customers: { id: Id<"customer">; name: string }[] = [],
): InvoiceLineCustomerReader => ({
	get: async (id) => {
		const customer = customers.find((c) => c.id === id);
		return customer === undefined ? undefined : { name: customer.name };
	},
});
