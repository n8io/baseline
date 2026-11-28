import { describe, expect, it } from "vitest";
import { shutdownLoggerDefault } from "./shutdown-logger-default.ts";

describe("shutdown logger default", () => {
	it("returns one working logger on every call", () => {
		const first = shutdownLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(shutdownLoggerDefault()).toBe(first);
	});
});
