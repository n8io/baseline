import { logger } from "@n8io/baseline-logger";
import type { ShutdownStep } from "@n8io/baseline-shutdown";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { errorTrackingOpen } from "./error-tracking-open.ts";

const errorTracking = vi.hoisted(() => ({
	close: vi.fn(async () => {}),
	report: vi.fn(),
}));
vi.mock("@n8io/baseline-error-tracking", () => ({
	errorTrackingSentryCreate: () => errorTracking,
}));

describe("errorTrackingOpen", () => {
	it("reports nothing, with nothing to close, when there is no DSN", () => {
		const steps: ShutdownStep[] = [];
		errorTrackingOpen({ dsn: undefined, environment: "test" }, steps);
		expect(steps).toEqual([]);
	});

	it("reports each error the logger logs until shutdown, then closes", async () => {
		const steps: ShutdownStep[] = [];
		// .env.test sets LOG_LEVEL silent, and a level that is off reaches no listener.
		const level = logger.level;
		const writable = logger as { level: string };
		writable.level = "error";
		onTestFinished(() => {
			writable.level = level;
		});
		errorTrackingOpen(
			{ dsn: "https://public@o1.ingest.sentry.io/1", environment: "test" },
			steps,
		);
		const error = new Error("boom");

		logger.error({ err: error }, "Queue error");
		expect(errorTracking.report).toHaveBeenCalledWith(error);

		expect(steps.map((s) => s.name)).toEqual(["error tracking"]);
		await steps[0]?.close();
		logger.error({ err: new Error("after shutdown") });

		expect(errorTracking.close).toHaveBeenCalledOnce();
		expect(errorTracking.report).toHaveBeenCalledOnce();
	});
});
