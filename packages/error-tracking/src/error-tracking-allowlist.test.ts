import type { ErrorEvent } from "@sentry/core";
import { describe, expect, it } from "vitest";
import { errorTrackingAllowlist } from "./error-tracking-allowlist.ts";

const eventOf = (fields: Record<string, unknown>): ErrorEvent =>
	({ type: undefined, ...fields }) as ErrorEvent;

describe("errorTrackingAllowlist", () => {
	it("keeps each allowed field and drops every other", () => {
		const allowed = {
			dist: "1",
			environment: "test",
			event_id: "id",
			exception: { values: [] },
			level: "error",
			platform: "node",
			release: "r",
			sdk: { name: "n" },
			sdkProcessingMetadata: { trace: true },
			tags: { a: "b" },
			timestamp: 1,
			type: undefined,
		};
		const out = errorTrackingAllowlist(
			eventOf({ ...allowed, extra: 1, request: {}, server_name: "host" }),
		);

		expect(Object.keys(out).sort()).toEqual(
			[...Object.keys(allowed), "contexts"].sort(),
		);
	});

	it("keeps contexts runtime and trace only, and always sets contexts", () => {
		const out = errorTrackingAllowlist(
			eventOf({
				contexts: {
					device: { a: 1 },
					runtime: { name: "node" },
					trace: { a: 1 },
				},
			}),
		);

		expect(out.contexts).toEqual({
			runtime: { name: "node" },
			trace: { a: 1 },
		});
		expect(errorTrackingAllowlist(eventOf({})).contexts).toEqual({});
	});

	it("does not change the event it is given", () => {
		const event = eventOf({ extra: 1 });

		errorTrackingAllowlist(event);

		expect(event).toHaveProperty("extra", 1);
	});
});
