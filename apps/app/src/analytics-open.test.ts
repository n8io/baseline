import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { describe, expect, it } from "vitest";
import { analyticsOpen } from "./analytics-open.ts";

describe("analyticsOpen", () => {
	it("logs instead of sending, with nothing to close, when there is no token", () => {
		const steps: ShutdownStep[] = [];
		analyticsOpen(undefined, steps);
		expect(steps).toEqual([]);
	});

	it("sends to Mixpanel with a token and waits for its sends at shutdown", async () => {
		const steps: ShutdownStep[] = [];
		analyticsOpen("token", steps);
		expect(steps.map((s) => s.name)).toEqual(["analytics"]);
		await expect(steps[0]?.close()).resolves.toBeUndefined();
	});
});
