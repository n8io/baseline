import { describe, expect, it } from "vitest";
import { z } from "zod";
import { featureFlagsDefine } from "./feature-flags-define.ts";

// The compile-time checks make a bad definition a type error, so these cast it away to reach
// the checks a JavaScript caller, or a definition built at run time, meets.
const defineLoose = (definitions: unknown): unknown =>
	(featureFlagsDefine as (definitions: unknown) => unknown)(definitions);

// Built from a variable so Biome's noThenProperty does not read the test double as a bug.
const thenKey = ["th", "en"].join("");

describe("featureFlagsDefine", () => {
	it("returns the declared flags, frozen and copied", () => {
		const input = {
			heroCopy: { fallback: "a", key: "hero", values: ["a", "b"] },
			on: { fallback: false, key: "on" },
		} as const;
		const flags = featureFlagsDefine(input);
		expect(flags).toEqual(input);
		expect(flags).not.toBe(input);
		expect(Object.isFrozen(flags)).toBe(true);
		expect(Object.isFrozen(flags.heroCopy)).toBe(true);
		expect(Object.isFrozen(flags.heroCopy.values)).toBe(true);
		expect(flags.heroCopy.values).not.toBe(input.heroCopy.values);
	});

	it("accepts a flag whose schema returns the fallback unchanged", () => {
		const flags = featureFlagsDefine({
			theme: {
				fallback: { mode: "light" },
				key: "theme",
				schema: z.object({ mode: z.enum(["dark", "light"]) }),
			},
		});
		expect(flags.theme.key).toBe("theme");
	});

	it.each([
		[
			"an empty key",
			{ a: { fallback: 1, key: "" } },
			"key must be a non-empty string",
		],
		[
			"a blank key",
			{ a: { fallback: 1, key: "  " } },
			"key must be a non-empty string",
		],
		["a missing key", { a: { fallback: 1 } }, "key must be a non-empty string"],
		[
			"a duplicate key",
			{ a: { fallback: 1, key: "k" }, b: { fallback: 2, key: "k" } },
			'flag b: key "k" is used by another flag',
		],
		[
			"__proto__",
			JSON.parse('{"__proto__":{"fallback":1,"key":"k"}}'),
			"__proto__ is a reserved name",
		],
		[
			"constructor",
			{ constructor: { fallback: 1, key: "k" } },
			"constructor is a reserved name",
		],
		[
			"prototype",
			{ prototype: { fallback: 1, key: "k" } },
			"prototype is a reserved name",
		],
		[
			"toString",
			{ toString: { fallback: 1, key: "k" } },
			"toString is a reserved name",
		],
		[
			"hasOwnProperty",
			{ hasOwnProperty: { fallback: 1, key: "k" } },
			"hasOwnProperty is a reserved name",
		],
		[
			"then",
			JSON.parse('{"then":{"fallback":1,"key":"k"}}'),
			"then is a reserved name",
		],
		[
			"a fallback outside values",
			{ a: { fallback: "c", key: "k", values: ["a", "b"] } },
			'fallback "c" must be one of values',
		],
		[
			"a fallback failing its schema",
			{
				a: {
					fallback: { mode: "neon" },
					key: "k",
					schema: z.object({ mode: z.enum(["dark"]) }),
				},
			},
			"fallback must pass its own schema",
		],
		[
			"an async schema",
			{
				a: {
					fallback: 1,
					key: "k",
					schema: {
						"~standard": {
							validate: () => Promise.resolve({ value: 1 }),
							vendor: "test",
							version: 1,
						},
					},
				},
			},
			"schema must validate synchronously",
		],
		["a null definition", { a: null }, "must be an object"],
		[
			"a schema answering with a thenable",
			{
				a: {
					fallback: 1,
					key: "k",
					schema: {
						"~standard": {
							validate: () => Object.fromEntries([[thenKey, () => undefined]]),
							vendor: "test",
							version: 1,
						},
					},
				},
			},
			"schema must validate synchronously",
		],
		[
			"values and schema together",
			{ a: { fallback: "a", key: "k", schema: z.string(), values: ["a"] } },
			"values and schema cannot be used together",
		],
		[
			"a fallback that is not a primitive and has no schema",
			{ a: { fallback: { x: 1 }, key: "k" } },
			"the flag needs a schema",
		],
	])("throws a TypeError for %s", (_name, definitions, message) => {
		expect(() => defineLoose(definitions)).toThrow(TypeError);
		expect(() => defineLoose(definitions)).toThrow(message);
		expect(() => defineLoose(definitions)).toThrow(/^featureFlagsDefine: /);
	});

	it("names the first flag that is wrong", () => {
		expect(() =>
			defineLoose({
				ok: { fallback: 1, key: "ok" },
				wrong: { fallback: 1, key: "" },
			}),
		).toThrow("featureFlagsDefine: flag wrong:");
	});
});
