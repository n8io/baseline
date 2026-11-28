import { describe, expect, it } from "vitest";
import { analyticsLoggerDefault } from "./analytics-logger-default.ts";

describe("analytics logger default", () => {
	it("returns one working logger on every call", () => {
		const first = analyticsLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(analyticsLoggerDefault()).toBe(first);
	});
});
