import type { Actor } from "@n8io/baseline-authn";
import { consumerCreate } from "@n8io/baseline-queue";
import { customerDeleted } from "#domains/customer/index.ts";
import type { InvoiceLineUseCases } from "../use-cases/invoice-line-use-cases-create.ts";

const invoiceLineCustomerDeletedConsumerActor: Actor = {
	id: "invoice-line-customer-deleted-consumer",
	kind: "client",
	scopes: [],
};

// Invoice lines stop naming a customer once it is deleted.
export const invoiceLineCustomerDeletedConsumer = (u: InvoiceLineUseCases) =>
	consumerCreate(
		"invoice-line.customer-deleted",
		"customer.deleted",
		customerDeleted,
		(event, inbox) =>
			u.invoiceLineCustomerClear(
				invoiceLineCustomerDeletedConsumerActor,
				{ customerId: event.customerId },
				inbox,
			),
	);
