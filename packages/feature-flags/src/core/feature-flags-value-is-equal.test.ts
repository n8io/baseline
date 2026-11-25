import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { featureFlagsValueIsEqual } from "./feature-flags-value-is-equal.ts";

describe("featureFlagsValueIsEqual", () => {
	it("compares primitives, arrays and objects by content", () => {
		expect(featureFlagsValueIsEqual(1, 1)).toBe(true);
		expect(featureFlagsValueIsEqual(1, "1")).toBe(false);
		expect(featureFlagsValueIsEqual(null, {})).toBe(false);
		expect(featureFlagsValueIsEqual([1, { a: 2 }], [1, { a: 2 }])).toBe(true);
		expect(featureFlagsValueIsEqual([1], [1, 2])).toBe(false);
		expect(featureFlagsValueIsEqual([], {})).toBe(false);
		expect(featureFlagsValueIsEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(featureFlagsValueIsEqual({ a: undefined }, { b: undefined })).toBe(
			false,
		);
	});

	it("holds that a value equals a copy of itself and is symmetric", () => {
		fc.assert(
			fc.property(fc.jsonValue(), fc.jsonValue(), (a, b) => {
				expect(featureFlagsValueIsEqual(a, structuredClone(a))).toBe(true);
				expect(featureFlagsValueIsEqual(a, b)).toBe(
					featureFlagsValueIsEqual(b, a),
				);
			}),
		);
	});
});
