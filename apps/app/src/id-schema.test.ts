import { idCreate } from "@n8io/baseline-id";
import { describe, expect, test } from "vitest";
import { idSchemaCreate } from "./id-schema.ts";

describe("idSchemaCreate", () => {
	test("accepts an id with its prefix", () => {
		const id = idCreate("thing");
		expect(idSchemaCreate("thing").parse(id)).toBe(id);
	});

	test.each([
		["another prefix", idCreate("other")],
		["a longer prefix", idCreate("thing_part")],
		["a malformed suffix", "thing_8zzzzzzzzzzzzzzzzzzzzzzzzz"],
		["a number", 42],
	])("rejects %s", (_name, value) => {
		expect(idSchemaCreate("thing").safeParse(value).success).toBe(false);
	});

	test("rejects a bad prefix", () => {
		expect(() => idSchemaCreate("thing-part")).toThrow(TypeError);
	});
});
