import { describe, expect, it } from "vitest";
import { httpLoggerDefault } from "./http-logger-default.ts";

describe("http logger default", () => {
	it("returns one working logger on every call", () => {
		const first = httpLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(httpLoggerDefault()).toBe(first);
	});
});
