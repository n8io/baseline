import { describe, expect, it } from "vitest";
import { loggerLevelAssert } from "./logger-level-assert.ts";

describe("loggerLevelAssert", () => {
	it.each(["fatal", "error", "warn", "info", "debug", "trace", "silent"])(
		"accepts %s",
		(level) => {
			expect(loggerLevelAssert(level)).toBe(level);
		},
	);

	it("throws a TypeError naming the levels and the bad value", () => {
		const assert = () => loggerLevelAssert("verbose");

		expect(assert).toThrow(TypeError);
		expect(assert).toThrow(
			'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent, not "verbose"',
		);
	});
});
