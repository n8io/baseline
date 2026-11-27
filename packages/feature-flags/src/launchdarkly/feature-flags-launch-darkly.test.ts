import { spawnSync } from "node:child_process";
import { TestData } from "@launchdarkly/node-server-sdk/integrations";
import { LaunchDarklyProvider } from "@launchdarkly/openfeature-node-server";
import { OpenFeature } from "@openfeature/server-sdk";
import { type LogRecord, logs } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { featureFlagsDefine } from "../core/feature-flags-define.ts";
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

// A global logger provider that keeps every record, as the telemetry preload would export them.
const records: LogRecord[] = [];
logs.setGlobalLoggerProvider({
	getLogger: () => ({
		emit: (record: LogRecord) => records.push(record),
		enabled: () => true,
	}),
});

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

	it("settles ready as failed when LaunchDarkly cannot start, and reads fall back", async () => {
		const fallbacks: unknown[] = [];
		const featureFlags = featureFlagsLaunchDarklyCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			onFallback: (fallback) => fallbacks.push(fallback),
			sdkKey: "sdk-test",
			vendor: {
				sendEvents: false,
				updateProcessor: (_context, _updates, _ok, errorHandler) => ({
					close: () => undefined,
					start: () => errorHandler?.(new Error("no connection")),
				}),
			},
		});
		expect(await featureFlags.ready).toBe("failed");
		expect(await featureFlags.context(actor).get("itemLimit")).toBe(10);
		expect(fallbacks).toEqual([
			{ flag: "itemLimit", key: "item-limit", reason: "vendorError" },
		]);
		await featureFlags.close();
	});

	it("logs a fallback as a warning by default, with the flag, key and reason", () => {
		const moduleUrl = new URL(
			"./feature-flags-launch-darkly.ts",
			import.meta.url,
		).href;
		const defsUrl = new URL(
			"../core/feature-flags-test-fixtures.ts",
			import.meta.url,
		).href;
		// A fresh Node process, since the logger writes to the process's own stdout.
		const result = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const { featureFlagsLaunchDarklyCreate } = await import(${JSON.stringify(moduleUrl)});
const { featureFlagsTestDefs } = await import(${JSON.stringify(defsUrl)});
const featureFlags = featureFlagsLaunchDarklyCreate({
	flags: featureFlagsTestDefs,
	sdkKey: "sdk-test",
	vendor: {
		sendEvents: false,
		updateProcessor: (_context, _updates, _ok, errorHandler) => ({
			close: () => undefined,
			start: () => errorHandler?.(new Error("no connection")),
		}),
	},
});
await featureFlags.ready;
await featureFlags.context({}).get("itemLimit");
await featureFlags.close();`,
			],
			{ encoding: "utf8", env: { ...process.env, LOG_LEVEL: "info" } },
		);
		const lines = result.stdout
			.split("\n")
			.filter((line) => line.startsWith("{"))
			.map((line) => JSON.parse(line) as Record<string, unknown>);
		expect(lines).toHaveLength(1);
		expect(lines[0]).toMatchObject({
			flag: "itemLimit",
			key: "item-limit",
			level: 40,
			msg: "Feature flag fell back to its default",
			reason: "vendorError",
		});
	});

	it("reads a flag whose fallback is not a JSON type as the fallback, reporting wrongType", async () => {
		const fallbacks: unknown[] = [];
		const featureFlags = featureFlagsLaunchDarklyCreate({
			flags: featureFlagsDefine({
				unset: { fallback: undefined, key: "unset", schema: z.undefined() },
			}),
			onFallback: (fallback) => fallbacks.push(fallback),
			sdkKey: "sdk-test",
			vendor: vendorOf(testDataCreate({ unset: "x" })),
		});
		await featureFlags.ready;
		expect(await featureFlags.context({}).get("unset")).toBeUndefined();
		expect(fallbacks).toEqual([
			{ flag: "unset", key: "unset", reason: "wrongType" },
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
		// Counts the provider closes by hand, then puts the real method back.
		const onClose = LaunchDarklyProvider.prototype.onClose;
		let closes = 0;
		LaunchDarklyProvider.prototype.onClose = function (...args) {
			closes += 1;
			return onClose.apply(this, args);
		};
		try {
			await first.close();
			expect(closes).toBeGreaterThan(0);
			expect(await first.context(actor).get("itemLimit")).toBe(10);
			expect(await second.context(actor).get("itemLimit")).toBe(3);
			await second.close();
		} finally {
			LaunchDarklyProvider.prototype.onClose = onClose;
		}
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

	it("records each read as a feature_flag.evaluation event, with no context in it", async () => {
		records.length = 0;
		const featureFlags = featureFlagsLaunchDarklyCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			sdkKey: "sdk-test",
			vendor: vendorOf(testDataCreate({ "item-limit": 3 })),
		});
		await featureFlags.ready;
		const handle = featureFlags.context({
			actor: { attributes: { email: "jane@example.com" }, id: "user_secret" },
		});
		await handle.get("itemLimit");
		await handle.get("checkoutRedesign");
		await featureFlags.close();
		expect(records.map((record) => record.eventName)).toEqual([
			"feature_flag.evaluation",
			"feature_flag.evaluation",
		]);
		expect(records[0]?.attributes).toMatchObject({
			"feature_flag.key": "item-limit",
			"feature_flag.provider.name": "launchdarkly",
			"feature_flag.result.reason": "default",
		});
		expect(records[0]?.attributes).toHaveProperty(
			"feature_flag.result.variant",
		);
		expect(records[1]?.attributes).toMatchObject({
			"error.type": "flag_not_found",
			"feature_flag.key": "checkout-redesign",
			"feature_flag.result.reason": "error",
		});
		const text = JSON.stringify(records);
		expect(text).not.toContain("jane");
		expect(text).not.toContain("user_secret");
	});
});
