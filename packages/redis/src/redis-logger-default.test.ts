import { describe, expect, it } from "vitest";
import { redisLoggerDefault } from "./redis-logger-default.ts";

describe("redis logger default", () => {
	it("returns one working logger on every call", () => {
		const first = redisLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(redisLoggerDefault()).toBe(first);
	});
});
