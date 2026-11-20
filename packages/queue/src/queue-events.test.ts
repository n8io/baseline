import { describe, expect, it } from "vitest";
import { queueEventsPublisherMemoryCreate } from "./index.ts";
import {
	type QueueTestEvents,
	queueEventsPublisherContract,
} from "./queue-events-publisher.contract.ts";

describe("queueEventsPublisherMemoryCreate", () => {
	queueEventsPublisherContract(async (work) => {
		const published: {
			name: keyof QueueTestEvents;
			data: unknown;
			key: string;
		}[] = [];
		const publisher = queueEventsPublisherMemoryCreate<QueueTestEvents>({
			published,
		});
		await work(publisher);
		await publisher.committed();
		return published;
	});

	it("records publishes in `published` and delivers nothing", async () => {
		const published: {
			name: keyof QueueTestEvents;
			data: unknown;
			key: string;
		}[] = [];
		const publisher = queueEventsPublisherMemoryCreate<QueueTestEvents>({
			published,
		});

		await publisher.publish({
			data: { fooId: "foo_1" },
			key: "foo_1",
			name: "foo.created",
		});

		expect(published).toEqual([
			{ data: { fooId: "foo_1" }, key: "foo_1", name: "foo.created" },
		]);
	});

	it("reads `published: null` as a new array", async () => {
		await expect(
			queueEventsPublisherMemoryCreate<QueueTestEvents>({
				published: null,
			}).publish({
				data: { fooId: "foo_1" },
				key: "foo_1",
				name: "foo.created",
			}),
		).resolves.toBeUndefined();
	});
});
