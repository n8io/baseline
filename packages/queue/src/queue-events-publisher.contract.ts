import { describe, expect, it } from "vitest";
import type { EventsPublisher } from "./index.ts";

/** The Events the contract publishes. */
export type QueueTestEvents = { "foo.created": { fooId: string } };

/** One Event as the publisher's transport holds it once the transaction has committed. */
export type QueueTestPublished = { data: unknown; key: string; name: string };

/**
 * The behaviour every `EventsPublisher` has: the queue's and its memory twin. `transactionRun`
 * hands `work` a publisher in a fresh transaction, commits once `work` resolves, calls
 * `committed()`, and resolves with what the transport now holds, oldest first. A throw from
 * `work` rolls the transaction back and rejects.
 */
export const queueEventsPublisherContract = (
	transactionRun: (
		work: (publisher: EventsPublisher<QueueTestEvents>) => Promise<void>,
	) => Promise<QueueTestPublished[]>,
): void => {
	describe("EventsPublisher contract", () => {
		it("delivers an Event with its name, key and data once committed", async () => {
			const published = await transactionRun((publisher) =>
				publisher.publish({
					data: { fooId: "foo_1" },
					key: "foo_1",
					name: "foo.created",
				}),
			);

			expect(published).toEqual([
				{ data: { fooId: "foo_1" }, key: "foo_1", name: "foo.created" },
			]);
		});

		it("delivers several Events of one transaction in publish order", async () => {
			const published = await transactionRun(async (publisher) => {
				for (const fooId of ["foo_1", "foo_2", "foo_1"]) {
					await publisher.publish({
						data: { fooId },
						key: fooId,
						name: "foo.created",
					});
				}
			});

			expect(published.map(({ key }) => key)).toEqual([
				"foo_1",
				"foo_2",
				"foo_1",
			]);
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
			).rejects.toThrow(
				new TypeError("publish: key must not be empty (Event foo.created)"),
			);
		});
	});
};
