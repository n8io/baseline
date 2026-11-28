import { describe, expect, it } from "vitest";
import { authnLoggerDefault } from "./authn-logger-default.ts";

describe("authn logger default", () => {
	it("returns one working logger on every call", () => {
		const first = authnLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(authnLoggerDefault()).toBe(first);
	});
});
