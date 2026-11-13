import { ok } from "@n8io/baseline-result";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { queueConsumerCreate } from "./queue-consumer.ts";

const inbox = { consumer: "audit.foo-created", eventId: "job_1" };

// A Standard Schema from no library: its message repeats the value, as some validators' do, and it
// answers with a Promise as the spec allows.
const fooCreatedPlain: StandardSchemaV1<unknown, { fooId: string }> = {
	"~standard": {
		validate: async (value) => {
			const fooId = (value as { fooId?: unknown } | null)?.fooId;
			return typeof fooId === "string"
				? { value: { fooId } }
				: {
						issues: [
							{
								message: `Expected text (was ${JSON.stringify(value)})`,
								path: [{ key: "fooId" }],
							},
						],
					};
		},
		vendor: "test",
		version: 1,
	},
};

describe("queueConsumerCreate", () => {
	it.each([
		["a Zod schema", z.object({ fooId: z.string() })],
		["any Standard Schema", fooCreatedPlain],
	])("runs the Consumer with the Event parsed by %s", async (_name, schema) => {
		const run = vi.fn(async (_event: { fooId: string }) => ok(undefined));
		const consumer = queueConsumerCreate({
			queueName: "audit.foo-created",
			eventName: "foo.created",
			schema,
			run,
		});

		await consumer.run({ fooId: "foo_1", extra: true }, inbox);

		expect(run).toHaveBeenCalledWith({ fooId: "foo_1" }, inbox);
	});

	it.each([
		["a Zod schema", z.object({ fooId: z.string() })],
		["any Standard Schema", fooCreatedPlain],
	])(
		"fails an Event that does not match %s, naming paths and no values",
		async (_name, schema) => {
			const run = vi.fn(async () => ok(undefined));
			const consumer = queueConsumerCreate({
				queueName: "audit.foo-created",
				eventName: "foo.created",
				schema,
				run,
			});

			const failure = await consumer
				.run({ fooId: 42, secret: "hunter2" }, inbox)
				.catch((error: unknown) => error);

			expect(failure).toEqual(
				new Error("Event failed validation for audit.foo-created at fooId"),
			);
			expect((failure as Error).cause).toBeUndefined();
			expect(run).not.toHaveBeenCalled();
		},
	);

	it("names nested paths once each, and none for the Event itself", async () => {
		const consumer = queueConsumerCreate({
			queueName: "audit.foo-created",
			eventName: "foo.created",
			schema: z.object({
				items: z.array(z.strictObject({ name: z.string().min(2) })),
			}),
			run: async () => ok(undefined),
		});

		await expect(
			consumer.run({ items: [{ name: "a" }] }, inbox),
		).rejects.toThrow(
			new Error(
				"Event failed validation for audit.foo-created at items.0.name",
			),
		);
		await expect(consumer.run("hunter2", inbox)).rejects.toThrow(
			new Error("Event failed validation for audit.foo-created"),
		);
	});
});
