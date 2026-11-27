import type { LoggerErr } from "@n8io/baseline-logger/err-serialize";
import { describe, expect, it } from "vitest";
import { errorTrackingExceptionsCreate } from "./error-tracking-exceptions.ts";

const stack = "Error\n    at fn (/app/file.js:1:2)";

describe("errorTrackingExceptionsCreate", () => {
	it("lists the innermost cause first and marks only the outermost handled", () => {
		const err = {
			cause: { stack, type: "TypeError" },
			stack,
			type: "Error",
		} as LoggerErr;

		const out = errorTrackingExceptionsCreate(err);

		expect(out.map((e) => e.type)).toEqual(["TypeError", "Error"]);
		expect(out.map((e) => e.mechanism)).toEqual([
			undefined,
			{ handled: true, type: "generic" },
		]);
		expect(out[0]?.stacktrace?.frames?.at(-1)?.function).toBe("fn");
	});

	it("gives no frames when there is no stack", () => {
		const out = errorTrackingExceptionsCreate({ type: "Error" } as LoggerErr);

		expect(out).toEqual([
			{
				mechanism: { handled: true, type: "generic" },
				stacktrace: { frames: [] },
				type: "Error",
			},
		]);
	});
});
