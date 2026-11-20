import { describe, expect, it } from "vitest";
import type { EventsPublisher } from "./index.ts";

export type QueueTestEvents = { "foo.created": { fooId: string } };

/**
 * The behaviour every `EventsPublisher` has: the queue's and its memory twin. `transactionRun`
 * hands `work` a publisher in a fresh transaction, commits once `work` resolves, then calls
 * `committed()`; a throw from `work` rolls the transaction back and rejects.
 */
export const queueEventsPublisherContract = (
	transactionRun: (
		work: (publisher: EventsPublisher<QueueTestEvents>) => Promise<void>,
	) => Promise<void>,
): void => {
	describe("EventsPublisher contract", () => {
		it("publishes an Event with a key, then commits", async () => {
			await expect(
				transactionRun((publisher) =>
					publisher.publish({
						data: { fooId: "foo_1" },
						key: "foo_1",
						name: "foo.created",
					}),
				),
			).resolves.toBeUndefined();
		});

		it("publishes several Events in one transaction", async () => {
			await expect(
				transactionRun(async (publisher) => {
					for (const fooId of ["foo_1", "foo_2", "foo_1"]) {
						await publisher.publish({
							data: { fooId },
							key: fooId,
							name: "foo.created",
						});
					}
				}),
			).resolves.toBeUndefined();
		});

		it("refuses an empty key, naming the Event", async () => {
			await expect(
				transactionRun((publisher) =>
					publisher.publish({
						data: { fooId: "foo_1" },
						key: "",
						name: "foo.created",
					}),
				),
			).rejects.toThrow(new TypeError("Event foo.created needs a key"));
		});
	});
};
