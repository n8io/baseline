import { describe, expect, it } from "vitest";
import { cacheLoggerDefault } from "./cache-logger-default.ts";

describe("cache logger default", () => {
	it("returns one working logger on every call", () => {
		const first = cacheLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(cacheLoggerDefault()).toBe(first);
	});
});
