import type { Result } from "@n8io/baseline-result";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type Consumer,
	type Events,
	type EventsPublisher,
	queueEventsPublisherMemoryCreate,
} from "./index.ts";

type TestEvents = {
	"foo.created": { fooId: string };
	"foo.deleted": { n: number };
};

// Vitest requires an assertion in every test, and expectTypeOf makes none at run time, so each
// test also checks one value. The types are checked by `tsc --noEmit` (the Package's `check`).
describe("queue types", () => {
	it("an EventsPublisher takes only the Events of its map, with the data of that Event", () => {
		const publisher = queueEventsPublisherMemoryCreate<TestEvents>();

		expectTypeOf(publisher).toEqualTypeOf<EventsPublisher<TestEvents>>();
		expectTypeOf(publisher.publish<"foo.created">)
			.parameter(0)
			.toEqualTypeOf<{
				name: "foo.created";
				data: { fooId: string };
				key: string;
			}>();
		expectTypeOf(publisher.publish<"foo.created">).returns.toEqualTypeOf<
			Promise<void>
		>();
		const unknownEvent = {
			data: { fooId: "foo_1" },
			key: "k",
			// @ts-expect-error an Event outside the map
			name: "bar.created",
		} satisfies Parameters<typeof publisher.publish>[0];
		expect(unknownEvent.name).toBe("bar.created");
	});

	it("publisherCreate takes the Event map as its type argument", () => {
		expectTypeOf<Events["publisherCreate"]>().toBeFunction();
		expectTypeOf<ReturnType<Events["publisherCreate"]>>().toExtend<
			EventsPublisher<Record<string, unknown>>
		>();
		expect(typeof queueEventsPublisherMemoryCreate).toBe("function");
	});

	it("a Consumer runs Event data to a Result that carries a typed error", () => {
		expectTypeOf<Consumer["run"]>().returns.resolves.toEqualTypeOf<
			Result<unknown, { type: string }>
		>();
		expectTypeOf<Consumer["queueName"]>().toEqualTypeOf<string>();
		expect(true).toBe(true);
	});
});
