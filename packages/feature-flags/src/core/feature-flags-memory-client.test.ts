import { describe, expect, it } from "vitest";
import { featureFlagsClientContractRun } from "./feature-flags-client.contract.ts";
import { featureFlagsClientCreate } from "./feature-flags-client.ts";
import { featureFlagsContextFreeze } from "./feature-flags-context.ts";
import { featureFlagsMemoryClientCreate } from "./feature-flags-memory-client.ts";
import { featureFlagsMemorySourceClientCreate } from "./feature-flags-memory-source.ts";
import {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "./feature-flags-test-fixtures.ts";

// The contract runs against the memory source with raw values, so a wrong type can be loaded.
featureFlagsClientContractRun({
	create: ({ onFallback, values }) => {
		const source = featureFlagsMemorySourceClientCreate({
			context: featureFlagsContextFreeze({ actor: { id: "a1" } }),
			values,
		});
		return {
			client: featureFlagsClientCreate({
				flags: featureFlagsTestDefs,
				kinds: featureFlagsTestKinds,
				onFallback,
				source,
			}),
			valuesSet: (next) => source.valuesSet(next),
		};
	},
	name: "memory",
});

describe("featureFlagsMemoryClientCreate", () => {
	it("reads typed values, and valuesSet notifies only the flags that changed", async () => {
		await using client = featureFlagsMemoryClientCreate({
			context: { actor: { id: "a1" } },
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			values: { heroCopy: "bold" },
		});
		await client.ready;
		const hero: string[] = [];
		const limit: string[] = [];
		expect(client.flags.get("heroCopy")).toBe("bold");
		expect(client.flags.get("itemLimit")).toBe(10);
		client.flags.subscribe("heroCopy", () => {
			hero.push("changed");
		});
		client.flags.subscribe("itemLimit", () => {
			limit.push("changed");
		});
		client.valuesSet({ heroCopy: "plain" });
		expect(hero).toHaveLength(1);
		expect(limit).toEqual([]);
		expect(client.flags.get("heroCopy")).toBe("plain");
	});

	it("takes values as a function of the context and follows contextSet", async () => {
		await using client = featureFlagsMemoryClientCreate({
			context: { actor: { id: "a1" } },
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			values: (context) => ({ itemLimit: context.customer ? 50 : 5 }),
		});
		await client.ready;
		expect(client.flags.get("itemLimit")).toBe(5);
		await client.contextSet({
			actor: { id: "a1" },
			customer: { id: "c1" },
		});
		expect(client.flags.get("itemLimit")).toBe(50);
	});

	it("returns fallbacks until ready, and always when ready is failed", async () => {
		const before = featureFlagsMemoryClientCreate({
			context: { actor: { id: "a1" } },
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			values: { itemLimit: 3 },
		});
		expect(before.flags.get("itemLimit")).toBe(10);
		await before.ready;
		expect(before.flags.get("itemLimit")).toBe(3);
		await before.close();
		const failed = featureFlagsMemoryClientCreate({
			context: { actor: { id: "a1" } },
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			ready: "failed",
			values: { itemLimit: 3 },
		});
		expect(await failed.ready).toBe("failed");
		expect(failed.flags.get("itemLimit")).toBe(10);
		await failed.close();
	});
});
