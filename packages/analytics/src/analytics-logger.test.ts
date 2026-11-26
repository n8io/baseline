import { describe, expect, it } from "vitest";
import { analyticsLoggerCreate } from "./analytics-logger.ts";

type LogCall = [fields: unknown, message: string | undefined];

// A plain writer the test passes in as the logger option; it keeps what it was given.
const writerCreate = () => {
	const calls: LogCall[] = [];
	return {
		calls,
		logger: {
			debug: (fields: unknown, message?: string) => {
				calls.push([fields, message]);
			},
		},
	};
};

describe("analyticsLoggerCreate", () => {
	it("logs each event at debug and sends nothing", async () => {
		const writer = writerCreate();
		await using analytics = analyticsLoggerCreate({ logger: writer.logger });

		analytics.track({
			actorId: "user-1",
			name: "foo.created",
			properties: { fooId: "foo_1" },
		});

		expect(writer.calls).toEqual([
			[
				{ event: "foo.created", properties: { fooId: "foo_1" } },
				"Analytics event",
			],
		]);
	});

	it("uses the Package logger when the logger option is null", async () => {
		await using analytics = analyticsLoggerCreate({ logger: null });

		expect(() =>
			analytics.track({ actorId: "user-1", name: "foo.created" }),
		).not.toThrow();
	});

	it("leaves properties out of the log when they are null", async () => {
		const writer = writerCreate();
		await using analytics = analyticsLoggerCreate({ logger: writer.logger });

		analytics.track({
			actorId: "user-1",
			name: "foo.created",
			properties: null,
		});

		expect(writer.calls).toEqual([
			[{ event: "foo.created" }, "Analytics event"],
		]);
	});
});
