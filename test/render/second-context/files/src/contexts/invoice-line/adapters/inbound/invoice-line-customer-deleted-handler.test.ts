import type { Actor } from "@n8io/baseline-authn";
import { queueTestConsumerRun } from "@n8io/baseline-queue/testing";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../../connections.ts";
import { contextsCreate } from "../../../../contexts.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

// The handler as the Worker runs it, through the context's interface on memory connections.
const setup = async () => {
	const { customerContext, invoiceLineContext } = contextsCreate(connections);
	const { handlers, useCases } = invoiceLineContext;
	const handler = handlers.find(
		(each) => each.eventName === "customer.deleted",
	);
	if (!handler) throw new Error("no customer.deleted handler");
	const customer = await customerContext.useCases.customerCreate(owner, {
		name: "Acme",
	});
	if (!customer.ok) throw customer.error;
	const created = await useCases.invoiceLineCreate(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	const assigned = await useCases.invoiceLineCustomerAssign(owner, {
		customerId: customer.value.id,
		invoiceLineId: created.value.id,
	});
	if (!assigned.ok) throw assigned.error;
	return {
		customerId: customer.value.id,
		handler,
		invoiceLineId: created.value.id,
		useCases,
	};
};

describe("invoiceLineCustomerDeletedHandlerCreate", () => {
	it("listens for customer.deleted on its own queue", async () => {
		const { handler } = await setup();

		expect(handler).toMatchObject({
			eventName: "customer.deleted",
			queueName: "invoice-line.customer-deleted",
		});
	});

	it("clears the deleted customer from its invoice lines", async () => {
		const { customerId, handler, invoiceLineId, useCases } = await setup();

		const result = await queueTestConsumerRun({
			consumer: handler,
			data: { customerId },
		});

		expect(result).toEqual(ok(undefined));
		const line = await useCases.invoiceLineGet(owner, { invoiceLineId });
		if (!line.ok) throw line.error;
		expect(line.value.customerId).toBeUndefined();
	});

	it("passes the job's inbox through, so a repeated job changes nothing", async () => {
		const { customerId, handler, invoiceLineId, useCases } = await setup();
		await queueTestConsumerRun({
			consumer: handler,
			data: { customerId },
			eventId: "job-1",
		});
		const reassigned = await useCases.invoiceLineCustomerAssign(owner, {
			customerId,
			invoiceLineId,
		});
		if (!reassigned.ok) throw reassigned.error;

		const repeat = await queueTestConsumerRun({
			consumer: handler,
			data: { customerId },
			eventId: "job-1",
		});

		expect(repeat).toEqual(ok(undefined));
		const line = await useCases.invoiceLineGet(owner, { invoiceLineId });
		if (!line.ok) throw line.error;
		expect(line.value.customerId).toBe(customerId);
	});

	it("fails the job on an event that does not parse", async () => {
		const { handler } = await setup();

		await expect(
			queueTestConsumerRun({ consumer: handler, data: { customerId: "nope" } }),
		).rejects.toThrow();
	});
});
