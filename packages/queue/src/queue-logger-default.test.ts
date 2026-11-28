import { describe, expect, it } from "vitest";
import { queueLoggerDefault } from "./queue-logger-default.ts";

describe("queue logger default", () => {
	it("returns one working logger on every call", () => {
		const first = queueLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(queueLoggerDefault()).toBe(first);
	});
});
