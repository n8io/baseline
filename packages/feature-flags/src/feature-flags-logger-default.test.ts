import { describe, expect, it } from "vitest";
import { featureFlagsLoggerDefault } from "./feature-flags-logger-default.ts";

describe("feature-flags logger default", () => {
	it("returns one working logger on every call", () => {
		const first = featureFlagsLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(featureFlagsLoggerDefault()).toBe(first);
	});
});
