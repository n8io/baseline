import { describe, expect, it } from "vitest";
import { queryBooleansTyped } from "./api-check.ts";

describe("queryBooleansTyped", () => {
	const list = (schema: Record<string, unknown>, where = "query") => ({
		paths: {
			"/foos": {
				get: { parameters: [{ in: where, name: "count", schema }] },
			},
		},
	});

	it("reads a string query parameter with a boolean default as a boolean", () => {
		expect(
			queryBooleansTyped(list({ default: false, type: "string" })),
		).toStrictEqual(list({ default: false, type: "boolean" }));
	});

	it.each([
		["a string default", list({ default: "false", type: "string" })],
		["a path parameter", list({ default: false, type: "string" }, "path")],
		["a typed boolean", list({ default: false, type: "boolean" })],
	])("leaves %s alone", (_, document) => {
		expect(queryBooleansTyped(structuredClone(document))).toStrictEqual(
			document,
		);
	});
});
