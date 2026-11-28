import { describe, expect, it } from "vitest";
import { postgresLoggerDefault } from "./postgres-logger-default.ts";

describe("postgres logger default", () => {
	it("returns one working logger on every call", () => {
		const first = postgresLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(postgresLoggerDefault()).toBe(first);
	});
});
