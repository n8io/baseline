import { idCreate } from "@n8io/baseline-id";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceLineUseCases } from "../use-cases/invoice-line-use-cases.ts";
import { invoiceLineCustomerDeletedConsumerCreate } from "./invoice-line-customer-deleted-consumer.ts";

describe("invoiceLineCustomerDeletedConsumerCreate", () => {
	const invoiceLineCustomerClear = vi.fn(async () => ok(undefined));
	const consumer = invoiceLineCustomerDeletedConsumerCreate({
		invoiceLineCustomerClear,
	} as unknown as InvoiceLineUseCases);

	it("listens for customer.deleted on its own queue", () => {
		expect(consumer).toMatchObject({
			eventName: "customer.deleted",
			queueName: "invoice-line.customer-deleted",
		});
	});

	it("clears the customer with its own actor and the job's inbox", async () => {
		const customerId = idCreate("customer");
		const inbox = {
			consumer: "invoice-line.customer-deleted",
			eventId: "job-1",
		};

		expect(await consumer.run({ customerId }, inbox)).toEqual(ok(undefined));
		expect(invoiceLineCustomerClear).toHaveBeenCalledWith(
			{
				id: "invoice-line-customer-deleted-consumer",
				kind: "client",
				scopes: [],
			},
			{ customerId },
			inbox,
		);
	});

	it("fails the job on an event that does not parse", async () => {
		await expect(
			consumer.run({ customerId: "nope" }, { consumer: "c", eventId: "e" }),
		).rejects.toThrow();
	});
});
