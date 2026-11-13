import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { describe, expect, it } from "vitest";
import { errorTrackingOpen } from "./error-tracking-open.ts";

describe("errorTrackingOpen", () => {
	it("reports nothing, with nothing to close, when there is no DSN", () => {
		const steps: ShutdownStep[] = [];
		errorTrackingOpen({ dsn: undefined, environment: "test" }, steps);
		expect(steps).toEqual([]);
	});

	it("reports to Sentry with a DSN and stops at shutdown", async () => {
		const steps: ShutdownStep[] = [];
		errorTrackingOpen(
			{ dsn: "https://public@o1.ingest.sentry.io/1", environment: "test" },
			steps,
		);
		expect(steps.map((s) => s.name)).toEqual(["error tracking"]);
		await expect(steps[0]?.close()).resolves.toBeUndefined();
	});
});
