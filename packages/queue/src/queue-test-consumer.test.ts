import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { queueConsumerCreate } from "./queue-consumer.ts";
import { queueTestConsumerRun } from "./queue-test-consumer.ts";

const seen: { consumer: string; eventId: string }[] = [];

const consumer = queueConsumerCreate({
	eventName: "foo.created",
	queueName: "bar.foo-created",
	run: async (event: { id: string }, inbox) => {
		seen.push(inbox);
		return event.id === "bad" ? err({ type: "Bad" }) : ok(event.id);
	},
	schema: z.object({ id: z.string() }),
});

describe("queueTestConsumerRun", () => {
	it("runs the Consumer with an Inbox of its queue name and the given event id", async () => {
		const result = await queueTestConsumerRun({
			consumer,
			data: { id: "a" },
			eventId: "evt_1",
		});

		expect(result).toEqual(ok("a"));
		expect(seen.at(-1)).toEqual({
			consumer: "bar.foo-created",
			eventId: "evt_1",
		});
	});

	it("makes a new event id when none is given", async () => {
		await queueTestConsumerRun({ consumer, data: { id: "a" } });
		await queueTestConsumerRun({ consumer, data: { id: "a" }, eventId: null });

		const [first, second] = seen.slice(-2);
		expect(first?.eventId).not.toEqual(second?.eventId);
	});

	it("returns the Consumer's error result", async () => {
		expect(
			await queueTestConsumerRun({ consumer, data: { id: "bad" } }),
		).toEqual(err({ type: "Bad" }));
	});

	it("rejects an Event that fails the schema, as the worker would", async () => {
		await expect(
			queueTestConsumerRun({ consumer, data: { id: 1 } }),
		).rejects.toThrow("Event failed validation for bar.foo-created");
	});
});
