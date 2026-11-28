import { describe, expect, it } from "vitest";
import { liveLoggerDefault } from "./live-logger-default.ts";

describe("live logger default", () => {
	it("returns one working logger on every call", () => {
		const first = liveLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(liveLoggerDefault()).toBe(first);
	});
});
