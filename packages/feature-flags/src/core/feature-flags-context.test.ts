import { describe, expect, it } from "vitest";
import { featureFlagsContextFreeze } from "./feature-flags-context.ts";

describe("featureFlagsContextFreeze", () => {
	it("copies entries and attributes, drops empty kinds, and freezes all of it", () => {
		const attributes = { plan: "pro" };
		const given = {
			actor: { attributes, id: "a1" },
			customer: null,
			worker: undefined,
		};
		const frozen = featureFlagsContextFreeze(given);
		expect(frozen).toEqual({
			actor: { attributes: { plan: "pro" }, id: "a1" },
		});
		expect(Object.isFrozen(frozen)).toBe(true);
		expect(Object.isFrozen(frozen["actor"])).toBe(true);
		expect(Object.isFrozen(frozen["actor"]?.attributes)).toBe(true);
		attributes.plan = "free";
		expect(frozen["actor"]?.attributes).toEqual({ plan: "pro" });
	});
});
