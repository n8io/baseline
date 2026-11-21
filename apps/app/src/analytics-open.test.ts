import { describe, expect, it } from "vitest";
import { analyticsOpen } from "./analytics-open.ts";
import type { ShutdownSteps } from "./shutdown-step-add.ts";

const steps: ShutdownSteps = { intakes: [], resources: [] };

describe("analyticsOpen", () => {
	it("logs instead of sending, with nothing to close, when there is no token", () => {
		expect(analyticsOpen({ steps }).steps).toEqual(steps);
	});

	it("sends to Mixpanel with a token and waits for its sends at shutdown", async () => {
		const opened = analyticsOpen({ steps, token: "token" });
		expect(opened.steps.resources.map((s) => s.name)).toEqual(["analytics"]);
		expect(steps.resources).toEqual([]);
		await expect(opened.steps.resources[0]?.close()).resolves.toBeUndefined();
	});
});
