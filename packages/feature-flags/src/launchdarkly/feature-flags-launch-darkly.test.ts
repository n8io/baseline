import { TestData } from "@launchdarkly/node-server-sdk/integrations";
import { LaunchDarklyProvider } from "@launchdarkly/openfeature-node-server";
import { OpenFeature } from "@openfeature/server-sdk";
import { describe, expect, it, vi } from "vitest";
import { featureFlagsServerContractRun } from "../core/feature-flags-server.contract.ts";
import {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "../core/feature-flags-test-fixtures.ts";
import { featureFlagsLaunchDarklyCreate } from "./feature-flags-launch-darkly.ts";

// LaunchDarkly's offline test data: the real SDK and provider, with no network.
const testDataCreate = (
	values: Readonly<Record<string, unknown>>,
): TestData => {
	const testData = new TestData();
	for (const [key, value] of Object.entries(values)) {
		void testData.update(testData.flag(key).valueForAll(value));
	}
	return testData;
};

const vendorOf = (testData: TestData) =>
	({ sendEvents: false, updateProcessor: testData.getFactory() }) as const;

featureFlagsServerContractRun({
	create: ({ onFallback, values }) =>
		featureFlagsLaunchDarklyCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			onFallback,
			sdkKey: "sdk-test",
			vendor: vendorOf(testDataCreate(values)),
		}),
	name: "LaunchDarkly",
});

const actor = { actor: { id: "a1" } } as const;

describe("featureFlagsLaunchDarklyCreate", () => {
	it("targets by kind: each kind's id and attributes reach the rules", async () => {
		const testData = new TestData();
		await testData.update(
			testData
				.flag("item-limit")
				.variations(10, 99)
				.fallthroughVariation(0)
				.variationForContext("actor", "vip", 1)
				.ifMatch("customer", "plan", "pro")
				.thenReturn(1),
		);
		const featureFlags = featureFlagsLaunchDarklyCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			sdkKey: "sdk-test",
			vendor: vendorOf(testData),
		});
		await featureFlags.ready;
		const free = featureFlags.context({
			actor: { id: "a1" },
			customer: { attributes: { plan: "free" }, id: "c1" },
		});
		const pro = featureFlags.context({
			actor: { id: "a1" },
			customer: { attributes: { plan: "pro" }, id: "c2" },
		});
		expect(await free.get("itemLimit")).toBe(10);
		expect(await pro.get("itemLimit")).toBe(99);
		expect(
			await featureFlags.context({ actor: { id: "vip" } }).get("itemLimit"),
		).toBe(99);
		await featureFlags.close();
	});

	it("settles ready as timeout when LaunchDarkly does not answer, and reads fall back", async () => {
		const fallbacks: unknown[] = [];
		const featureFlags = featureFlagsLaunchDarklyCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			onFallback: (fallback) => fallbacks.push(fallback),
			readyTimeoutMs: 50,
			sdkKey: "sdk-test",
			vendor: {
				sendEvents: false,
				updateProcessor: () => ({
					close: () => undefined,
					start: () => undefined,
				}),
			},
		});
		expect(await featureFlags.ready).toBe("timeout");
		expect(await featureFlags.context(actor).get("itemLimit")).toBe(10);
		expect(fallbacks).toEqual([
			{ flag: "itemLimit", key: "item-limit", reason: "vendorError" },
		]);
		await featureFlags.close();
	});

	it("closes only its own instance", async () => {
		const open = () =>
			featureFlagsLaunchDarklyCreate({
				flags: featureFlagsTestDefs,
				kinds: featureFlagsTestKinds,
				sdkKey: "sdk-test",
				vendor: vendorOf(testDataCreate({ "item-limit": 3 })),
			});
		const first = open();
		const second = open();
		await Promise.all([first.ready, second.ready]);
		const close = vi.spyOn(LaunchDarklyProvider.prototype, "onClose");
		await first.close();
		expect(close).toHaveBeenCalled();
		expect(await first.context(actor).get("itemLimit")).toBe(10);
		expect(await second.context(actor).get("itemLimit")).toBe(3);
		await second.close();
		close.mockRestore();
	});

	it("closes through await using, and leaves the default OpenFeature provider alone", async () => {
		const before = OpenFeature.getClient().providerStatus;
		{
			await using featureFlags = featureFlagsLaunchDarklyCreate({
				flags: featureFlagsTestDefs,
				kinds: featureFlagsTestKinds,
				sdkKey: "sdk-test",
				vendor: vendorOf(testDataCreate({ "item-limit": 3 })),
			});
			await featureFlags.ready;
			expect(await featureFlags.context(actor).get("itemLimit")).toBe(3);
		}
		expect(OpenFeature.getClient().providerStatus).toBe(before);
	});
});
