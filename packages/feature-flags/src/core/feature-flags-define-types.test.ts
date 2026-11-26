import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { featureFlagsDefine } from "./feature-flags-define.ts";
import type { FlagValue } from "./feature-flags-define-types.ts";

const flags = featureFlagsDefine({
	copy: { fallback: "plain", key: "copy", values: ["plain", "bold"] },
	enabled: { fallback: false, key: "enabled" },
	limit: { fallback: 10, key: "limit" },
	name: { fallback: "x", key: "name" },
	theme: {
		fallback: { mode: "light" as const },
		key: "theme",
		schema: z.object({ mode: z.enum(["dark", "light"]) }),
	},
});

// Vitest requires an assertion in every test, and expectTypeOf makes none at run time, so each
// test also checks one value. The types are checked by `tsc --noEmit` (the Package's `check`).
describe("feature flag types", () => {
	it("widens a literal fallback to its type", () => {
		expectTypeOf<FlagValue<typeof flags.enabled>>().toEqualTypeOf<boolean>();
		expectTypeOf<FlagValue<typeof flags.limit>>().toEqualTypeOf<number>();
		expectTypeOf<FlagValue<typeof flags.name>>().toEqualTypeOf<string>();
		expect(flags.limit.fallback).toBe(10);
	});

	it("reads values as their union and a schema as its output", () => {
		expectTypeOf<FlagValue<typeof flags.copy>>().toEqualTypeOf<
			"bold" | "plain"
		>();
		expectTypeOf<FlagValue<typeof flags.theme>>().toEqualTypeOf<{
			mode: "dark" | "light";
		}>();
		expect(flags.copy.values).toEqual(["plain", "bold"]);
	});

	it("does not compile a mistake in a definition", () => {
		// Each call also throws when run, which is what a JavaScript caller meets.
		expect(() =>
			featureFlagsDefine({
				// @ts-expect-error a fallback outside values
				bad: { fallback: "c", key: "bad", values: ["a", "b"] },
			}),
		).toThrow(TypeError);
		expect(() =>
			featureFlagsDefine({
				bad: {
					// @ts-expect-error a fallback the schema's output does not have
					fallback: { mode: "neon" },
					key: "bad",
					schema: z.object({ mode: z.enum(["dark"]) }),
				},
			}),
		).toThrow(TypeError);
		expect(() =>
			// @ts-expect-error a flag without a key
			featureFlagsDefine({ bad: { fallback: true } }),
		).toThrow(TypeError);
		expect(() =>
			featureFlagsDefine({
				// @ts-expect-error values and schema together
				bad: { fallback: "a", key: "bad", schema: z.string(), values: ["a"] },
			}),
		).toThrow(TypeError);
	});
});
