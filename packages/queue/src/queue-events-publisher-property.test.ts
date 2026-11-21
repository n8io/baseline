import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { queueEventsPublisherMemoryCreate } from "./index.ts";

type Events = { "foo.created": { n: number }; "foo.deleted": { n: number } };

describe("queueEventsPublisherMemoryCreate properties", () => {
	it("keeps the Events of every key in the order they were published", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(
					fc.record({
						key: fc.constantFrom("foo_a", "foo_b", "foo_c"),
						name: fc.constantFrom("foo.created", "foo.deleted"),
					}),
					{ maxLength: 40 },
				),
				async (events) => {
					const published: {
						name: keyof Events;
						data: unknown;
						key: string;
					}[] = [];
					const publisher = queueEventsPublisherMemoryCreate<Events>({
						published,
					});
					for (const [n, event] of events.entries()) {
						await publisher.publish({ ...event, data: { n } });
					}
					await publisher.committed();

					for (const key of new Set(events.map((event) => event.key))) {
						const expected = events
							.map((event, n) => ({ ...event, n }))
							.filter((event) => event.key === key)
							.map((event) => event.n);
						const actual = published
							.filter((event) => event.key === key)
							.map((event) => (event.data as { n: number }).n);

						expect(actual).toEqual(expected);
					}
					expect(published).toHaveLength(events.length);
				},
			),
		);
	});

	it("refuses an empty key whatever the Event", async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.constantFrom("foo.created", "foo.deleted"),
				async (name) => {
					await expect(
						queueEventsPublisherMemoryCreate<Events>().publish({
							data: { n: 0 },
							key: "",
							name,
						}),
					).rejects.toThrow(/key must not be empty/);
				},
			),
		);
	});
});
