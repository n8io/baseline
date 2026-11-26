import { type Logger, logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, it } from "vitest";
import { analyticsLoggerCreate } from "./analytics-logger.ts";

type LogCall = [fields: unknown, message?: string];

const restores: (() => void)[] = [];

// A hand-written recording double for one logger method, put back by afterEach.
const loggerRecord = (method: "debug") => {
	const calls: LogCall[] = [];
	const original = logger[method];
	logger[method] = ((...args: LogCall) => {
		calls.push(args);
	}) as Logger[typeof method];
	restores.push(() => {
		logger[method] = original;
	});
	return calls;
};

afterEach(() => {
	for (const restore of restores.splice(0)) restore();
});

describe("analyticsLoggerCreate", () => {
	it("logs each event at debug and sends nothing", async () => {
		const debug = loggerRecord("debug");
		await using analytics = analyticsLoggerCreate();

		analytics.track({
			actorId: "user-1",
			name: "foo.created",
			properties: { fooId: "foo_1" },
		});

		expect(debug).toEqual([
			[
				{ event: "foo.created", properties: { fooId: "foo_1" } },
				"Analytics event",
			],
		]);
	});

	it("leaves properties out of the log when they are null", async () => {
		const debug = loggerRecord("debug");
		await using analytics = analyticsLoggerCreate();

		analytics.track({
			actorId: "user-1",
			name: "foo.created",
			properties: null,
		});

		expect(debug).toEqual([[{ event: "foo.created" }, "Analytics event"]]);
	});
});
