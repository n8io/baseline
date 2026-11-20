import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { idSchemaCreate } from "./id-schema.ts";

describe("idSchemaCreate", () => {
	it("accepts an id with its prefix", () => {
		const id = idCreate("thing");
		expect(idSchemaCreate("thing").parse(id)).toBe(id);
	});

	it.each([
		["another prefix", idCreate("other")],
		["a longer prefix", idCreate("thing_part")],
		["a malformed suffix", "thing_8zzzzzzzzzzzzzzzzzzzzzzzzz"],
		["a number", 42],
	])("rejects %s", (_name, value) => {
		expect(idSchemaCreate("thing").safeParse(value).success).toBe(false);
	});

	it("rejects a bad prefix", () => {
		expect(() => idSchemaCreate("thing-part")).toThrow(TypeError);
	});
});
