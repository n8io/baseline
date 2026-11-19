import { idCreate } from "@n8io/baseline-id";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it, vi } from "vitest";
import type { InvoiceLineUseCases } from "../../application/invoice-line-use-cases.ts";
import { invoiceLineCustomerDeletedHandlerCreate } from "./invoice-line-customer-deleted-handler.ts";

describe("invoiceLineCustomerDeletedHandlerCreate", () => {
	const invoiceLineCustomerClear = vi.fn(async () => ok(undefined));
	const handler = invoiceLineCustomerDeletedHandlerCreate({
		invoiceLineCustomerClear,
	} as unknown as InvoiceLineUseCases);

	it("listens for customer.deleted on its own queue", () => {
		expect(handler).toMatchObject({
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

		expect(await handler.run({ customerId }, inbox)).toEqual(ok(undefined));
		expect(invoiceLineCustomerClear).toHaveBeenCalledWith(
			{
				id: "invoice-line-customer-deleted-handler",
				kind: "client",
				scopes: [],
			},
			{ customerId, inbox },
		);
	});

	it("fails the job on an event that does not parse", async () => {
		await expect(
			handler.run({ customerId: "nope" }, { consumer: "c", eventId: "e" }),
		).rejects.toThrow();
	});
});
