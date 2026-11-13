import type { Actor } from "@n8io/baseline-authn";
import { queueConsumerCreate } from "@n8io/baseline-queue";
import { customerDeleted } from "#domains/customer/index.ts";
import type { InvoiceLineUseCases } from "../index.ts";

const invoiceLineCustomerDeletedConsumerActor: Actor = {
	id: "invoice-line-customer-deleted-consumer",
	kind: "client",
	scopes: [],
};

// Invoice lines stop naming a customer once it is deleted.
export const invoiceLineCustomerDeletedConsumerCreate = (
	u: InvoiceLineUseCases,
) =>
	queueConsumerCreate({
		queueName: "invoice-line.customer-deleted",
		eventName: "customer.deleted",
		schema: customerDeleted,
		run: (event, inbox) =>
			u.invoiceLineCustomerClear(invoiceLineCustomerDeletedConsumerActor, {
				customerId: event.customerId,
				inbox,
			}),
	});
