import { describe, expect, it, vi } from "vitest";
import { featureFlagsClientCreate } from "./feature-flags-client.ts";
import { featureFlagsMemorySourceClientCreate } from "./feature-flags-memory-source.ts";
import { featureFlagsServerCreate } from "./feature-flags-server.ts";
import { featureFlagsTestDefs } from "./feature-flags-test-fixtures.ts";

const clientOpen = () => {
	const source = featureFlagsMemorySourceClientCreate({
		context: {},
		values: () => ({ "checkout-redesign": false, "item-limit": 3 }),
	});
	const client = featureFlagsClientCreate({
		flags: featureFlagsTestDefs,
		source,
	});
	return { client, source };
};

describe("featureFlagsServerCreate with a misbehaving source", () => {
	it("returns the fallback when read throws before it returns a Promise", async () => {
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			source: {
				close: () => {
					throw new Error("close");
				},
				read: () => {
					throw new Error("read");
				},
				ready: Promise.resolve("connected"),
			},
		});
		await featureFlags.ready;
		expect(await featureFlags.context({}).get("itemLimit")).toBe(10);
		await expect(featureFlags.close()).resolves.toBeUndefined();
	});

	it("never waits on a source whose ready does not settle", async () => {
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			source: {
				close: () => Promise.resolve(),
				read: () => Promise.resolve({ found: true, value: 3 }),
				ready: new Promise(() => undefined),
			},
		});
		expect(await featureFlags.context({}).get("itemLimit")).toBe(10);
	});

	it("survives a logger whose Promise rejects, and does not log notReady or closed", async () => {
		const logged: string[] = [];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onFallback: ({ reason }) => {
				logged.push(reason);
				return Promise.reject(new Error("logger"));
			},
			source: {
				close: () => Promise.resolve(),
				read: () => Promise.resolve({ found: false, reason: "vendorError" }),
				ready: Promise.resolve("connected"),
			},
		});
		const handle = featureFlags.context({});
		await handle.get("itemLimit");
		await featureFlags.ready;
		await handle.get("itemLimit");
		await featureFlags.close();
		await handle.get("itemLimit");
		expect(logged).toEqual(["vendorError"]);
	});
});

describe("featureFlagsClientCreate with misbehaving subscribers and sources", () => {
	it("keeps notifying the others, and resolves contextSet, when a subscriber throws", async () => {
		const { client, source } = clientOpen();
		await client.ready;
		const other = vi.fn();
		expect(client.flags.get("itemLimit")).toBe(3);
		expect(client.flags.get("checkoutRedesign")).toBe(false);
		client.flags.subscribe("itemLimit", () => {
			throw new Error("subscriber");
		});
		client.flags.subscribe("checkoutRedesign", other);
		source.valuesSet(() => ({ "checkout-redesign": true, "item-limit": 4 }));
		await expect(client.contextSet({})).resolves.toBeUndefined();
		expect(client.flags.get("itemLimit")).toBe(4);
		expect(client.flags.get("checkoutRedesign")).toBe(true);
		expect(other).toHaveBeenCalledTimes(1);
	});

	it("unsubscribes one subscription at a time, even for the same function", async () => {
		const { client, source } = clientOpen();
		await client.ready;
		const listener = vi.fn();
		client.flags.get("itemLimit");
		const first = client.flags.subscribe("itemLimit", listener);
		client.flags.subscribe("itemLimit", listener);
		first();
		source.valuesSet(() => ({ "item-limit": 4 }));
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("returns the fallback when the source throws, and keeps going", async () => {
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			source: {
				close: () => {
					throw new Error("close");
				},
				contextSet: () => {
					throw new Error("contextSet");
				},
				read: () => {
					throw new Error("read");
				},
				ready: Promise.resolve("connected"),
				subscribe: () => () => undefined,
			},
		});
		await client.ready;
		expect(client.flags.get("itemLimit")).toBe(10);
		await expect(client.contextSet({})).resolves.toBeUndefined();
		await expect(client.close()).resolves.toBeUndefined();
	});

	it("does not log notReady, and logs a reason once until it changes", async () => {
		const logged: string[] = [];
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			onFallback: ({ reason }) => {
				logged.push(reason);
			},
			source: featureFlagsMemorySourceClientCreate({
				context: {},
				values: () => ({ "item-limit": "ten" }),
			}),
		});
		client.flags.get("itemLimit");
		await client.ready;
		client.flags.get("itemLimit");
		await client.contextSet({});
		expect(logged).toEqual(["wrongType"]);
		await client.close();
	});
});
