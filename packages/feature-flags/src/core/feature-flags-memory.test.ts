import { describe, expect, it } from "vitest";
import { featureFlagsMemoryCreate } from "./feature-flags-memory.ts";
import { featureFlagsMemorySourceServerCreate } from "./feature-flags-memory-source.ts";
import { featureFlagsServerContractRun } from "./feature-flags-server.contract.ts";
import { featureFlagsServerCreate } from "./feature-flags-server.ts";
import {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "./feature-flags-test-fixtures.ts";

// The contract runs against the memory source with raw values, so a wrong type can be loaded.
featureFlagsServerContractRun({
	create: ({ onFallback, values }) =>
		featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			onFallback,
			source: featureFlagsMemorySourceServerCreate({ values: () => values }),
		}),
	name: "memory",
});

describe("featureFlagsMemoryCreate", () => {
	it("reads typed values by flag name, and leaves a flag out as its fallback", async () => {
		await using featureFlags = featureFlagsMemoryCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			values: { heroCopy: "bold", itemLimit: 3 },
		});
		await featureFlags.ready;
		const handle = featureFlags.context({ actor: { id: "a1" } });
		expect(await handle.get("heroCopy")).toBe("bold");
		expect(await handle.get("itemLimit")).toBe(3);
		expect(await handle.get("checkoutRedesign")).toBe(false);
	});

	it("serves values chosen by the context, and one handle never sees another's", async () => {
		await using featureFlags = featureFlagsMemoryCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			values: (context) => ({
				checkoutRedesign: context.actor.id === "a1",
				itemLimit: context.customer ? 50 : 5,
			}),
		});
		await featureFlags.ready;
		const first = featureFlags.context({ actor: { id: "a1" } });
		const second = featureFlags.context({
			actor: { id: "b2" },
			customer: { attributes: { plan: "pro" }, id: "c1" },
		});
		expect(await first.get("checkoutRedesign")).toBe(true);
		expect(await first.get("itemLimit")).toBe(5);
		expect(await second.get("checkoutRedesign")).toBe(false);
		expect(await second.get("itemLimit")).toBe(50);
	});

	it("freezes the context it was given, so editing it later changes nothing", async () => {
		await using featureFlags = featureFlagsMemoryCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			values: (context) => ({ itemLimit: context.actor.id === "a1" ? 1 : 2 }),
		});
		await featureFlags.ready;
		const actor = { id: "a1" };
		const handle = featureFlags.context({ actor });
		actor.id = "b2";
		expect(await handle.get("itemLimit")).toBe(1);
	});

	it("returns fallbacks when ready is failed or timeout, like an outage", async () => {
		const fallbacks: string[] = [];
		await using featureFlags = featureFlagsMemoryCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			onFallback: ({ reason }) => {
				fallbacks.push(reason);
			},
			ready: "timeout",
			values: { itemLimit: 3 },
		});
		expect(await featureFlags.ready).toBe("timeout");
		expect(
			await featureFlags.context({ actor: { id: "a1" } }).get("itemLimit"),
		).toBe(10);
		expect(fallbacks).toEqual(["vendorError"]);
	});

	it("keeps reading when the logger throws", async () => {
		await using featureFlags = featureFlagsMemoryCreate({
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			onFallback: () => {
				throw new Error("logger down");
			},
		});
		await featureFlags.ready;
		expect(
			await featureFlags.context({ actor: { id: "a1" } }).get("itemLimit"),
		).toBe(10);
	});

	it("returns undefined and logs once for a name that was never declared", async () => {
		const fallbacks: unknown[] = [];
		const featureFlags = featureFlagsMemoryCreate({
			flags: featureFlagsTestDefs,
			onFallback: (fallback) => {
				fallbacks.push(fallback);
			},
		});
		await featureFlags.ready;
		const handle = featureFlags.context({}) as unknown as {
			get(flag: string): Promise<unknown>;
		};
		expect(await handle.get("toString")).toBeUndefined();
		expect(await handle.get("toString")).toBeUndefined();
		expect(fallbacks).toEqual([
			{ flag: "toString", key: "", reason: "notFound" },
		]);
		await featureFlags.close();
	});
});
