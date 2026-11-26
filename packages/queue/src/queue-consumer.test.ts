import { ok } from "@n8io/baseline-result";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queueConsumerCreate } from "./queue-consumer.ts";

// A hand-written Consumer run that records the Event and Inbox it is called with.
const runRecord = <Result>(result: Result) => {
	const calls: unknown[][] = [];
	const run = async (...args: unknown[]): Promise<Result> => {
		calls.push(args);
		return result;
	};
	return { calls, run };
};

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
		const { calls, run } = runRecord(ok(undefined));
		const consumer = queueConsumerCreate({
			queueName: "audit.foo-created",
			eventName: "foo.created",
			schema,
			run,
		});

		await consumer.run({ fooId: "foo_1", extra: true }, inbox);

		expect(calls).toEqual([[{ fooId: "foo_1" }, inbox]]);
	});

	it.each([
		["a Zod schema", z.object({ fooId: z.string() })],
		["any Standard Schema", fooCreatedPlain],
	])(
		"fails an Event that does not match %s, naming paths and no values",
		async (_name, schema) => {
			const { calls, run } = runRecord(ok(undefined));
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
			expect(calls).toEqual([]);
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

	it("parses the event and passes the inbox through", async () => {
		const fooCreated = z.object({ fooId: z.string() });
		const { calls, run } = runRecord(ok("done"));
		const consumer = queueConsumerCreate({
			queueName: "billing.foo-created",
			eventName: "foo.created",
			schema: fooCreated,
			run,
		});
		const inbox = { consumer: "billing.foo-created", eventId: "job-1" };

		expect(await consumer.run({ extra: 1, fooId: "foo_1" }, inbox)).toEqual(
			ok("done"),
		);
		expect(calls).toEqual([[{ fooId: "foo_1" }, inbox]]);
		expect(consumer).toMatchObject({
			eventName: "foo.created",
			queueName: "billing.foo-created",
		});
	});
});
