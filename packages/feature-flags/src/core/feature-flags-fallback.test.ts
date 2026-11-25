import { describe, expect, it } from "vitest";
import { featureFlagsFallbackCreate } from "./feature-flags-fallback.ts";
import {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "./feature-flags-test-fixtures.ts";

describe("featureFlagsFallbackCreate", () => {
	it("reads every flag as its declared fallback, once ready", async () => {
		await using featureFlags = featureFlagsFallbackCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
		});
		expect(await featureFlags.ready).toBe("connected");
		const handle = featureFlags.context({ actor: { id: "a1" } });
		expect(await handle.get("checkoutRedesign")).toBe(false);
		expect(await handle.get("heroCopy")).toBe("plain");
		expect(await handle.get("itemLimit")).toBe(10);
	});

	it("keeps answering with fallbacks after close", async () => {
		const featureFlags = featureFlagsFallbackCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
		});
		await featureFlags.close();
		expect(
			await featureFlags.context({ actor: { id: "a1" } }).get("itemLimit"),
		).toBe(10);
	});
});
