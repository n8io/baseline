import type { Actor } from "@n8io/baseline-authn";
import { queueConsumerCreate } from "@n8io/baseline-queue";
import { customerDeleted } from "#contexts/customer/index.ts";
import type { InvoiceLineUseCases } from "../../index.ts";

const invoiceLineCustomerDeletedHandlerActor: Actor = {
	id: "invoice-line-customer-deleted-handler",
	kind: "client",
	scopes: [],
};

// Invoice lines stop naming a customer once it is deleted.
export const invoiceLineCustomerDeletedHandlerCreate = (
	u: InvoiceLineUseCases,
) =>
	queueConsumerCreate({
		queueName: "invoice-line.customer-deleted",
		eventName: "customer.deleted",
		schema: customerDeleted,
		run: (event, inbox) =>
			u.invoiceLineCustomerClear(invoiceLineCustomerDeletedHandlerActor, {
				customerId: event.customerId,
				inbox,
			}),
	});
