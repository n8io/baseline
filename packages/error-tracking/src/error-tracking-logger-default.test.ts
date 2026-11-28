import { describe, expect, it } from "vitest";
import { errorTrackingLoggerDefault } from "./error-tracking-logger-default.ts";

describe("error-tracking logger default", () => {
	it("returns one working logger on every call", () => {
		const first = errorTrackingLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(errorTrackingLoggerDefault()).toBe(first);
	});
});
