import { idCreate } from "@n8io/baseline-id";
import { describe, expect, test } from "vitest";
import { idSchemaCreate } from "./id-schema.ts";

describe("idSchemaCreate", () => {
	test("accepts an id with its prefix", () => {
		const id = idCreate("foo");
		expect(idSchemaCreate("foo").parse(id)).toBe(id);
	});

	test.each([
		["another prefix", idCreate("bar")],
		["a longer prefix", idCreate("foo_bar")],
		["a malformed suffix", "foo_8zzzzzzzzzzzzzzzzzzzzzzzzz"],
		["a number", 42],
	])("rejects %s", (_name, value) => {
		expect(idSchemaCreate("foo").safeParse(value).success).toBe(false);
	});

	test("rejects a bad prefix", () => {
		expect(() => idSchemaCreate("foo-bar")).toThrow(TypeError);
	});
});
