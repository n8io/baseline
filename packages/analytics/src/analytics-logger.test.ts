import { logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { analyticsLoggerCreate } from "./analytics-logger.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("analyticsLoggerCreate", () => {
	it("logs each event at debug and sends nothing", async () => {
		const debug = vi.spyOn(logger, "debug").mockImplementation(() => undefined);
		const analytics = analyticsLoggerCreate();

		analytics.track({
			actorId: "user-1",
			name: "foo.created",
			properties: { fooId: "foo_1" },
		});
		await analytics.close();

		expect(debug).toHaveBeenCalledWith(
			{ event: "foo.created", properties: { fooId: "foo_1" } },
			"Analytics event",
		);
	});
});
