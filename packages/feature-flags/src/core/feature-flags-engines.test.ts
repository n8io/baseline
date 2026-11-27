import { describe, expect, it } from "vitest";
import { featureFlagsClientCreate } from "./feature-flags-client.ts";
import type { FeatureFlagsClientSource } from "./feature-flags-client-types.ts";
import { featureFlagsMemorySourceClientCreate } from "./feature-flags-memory-source.ts";
import type {
	FeatureFlagEvaluation,
	FeatureFlagRead,
} from "./feature-flags-resolve-types.ts";
import { featureFlagsServerCreate } from "./feature-flags-server.ts";
import type { FeatureFlagsServerSource } from "./feature-flags-server-types.ts";
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
		const fallbacks: unknown[] = [];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onFallback: (fallback) => fallbacks.push(fallback),
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
		expect(fallbacks).toEqual([
			{ flag: "itemLimit", key: "item-limit", reason: "vendorError" },
		]);
		await expect(featureFlags.close()).resolves.toBeUndefined();
	});

	it("settles ready as failed when the source's ready rejects, and still reads", async () => {
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			source: {
				close: () => Promise.resolve(),
				read: () => Promise.resolve({ found: true, value: 3 }),
				ready: Promise.reject(new Error("ready")),
			},
		});
		expect(await featureFlags.ready).toBe("failed");
		expect(await featureFlags.context({}).get("itemLimit")).toBe(3);
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

describe("featureFlagsServerCreate outage logging and evaluations", () => {
	const sourceOf = (reads: FeatureFlagRead[]): FeatureFlagsServerSource => ({
		close: () => Promise.resolve(),
		read: () => Promise.resolve(reads.shift() ?? { found: true, value: 3 }),
		ready: Promise.resolve("connected"),
	});

	it("logs an outage once, then once when reads recover, and again for the next outage", async () => {
		const events: string[] = [];
		const down: FeatureFlagRead = { found: false, reason: "vendorError" };
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onFallback: ({ reason }) => events.push(reason),
			onRecovered: () => events.push("recovered"),
			source: sourceOf([
				down,
				down,
				down,
				{ found: true, value: 4 },
				{ found: true, value: 5 },
				down,
			]),
		});
		await featureFlags.ready;
		const handle = featureFlags.context({});
		const values = [];
		for (let index = 0; index < 6; index++) {
			values.push(await handle.get("itemLimit"));
		}
		expect(values).toEqual([10, 10, 10, 4, 5, 10]);
		expect(events).toEqual(["vendorError", "recovered", "vendorError"]);
	});

	it("tells onEvaluation about every read, with the service's reason and variant, never the context", async () => {
		const evaluations: FeatureFlagEvaluation[] = [];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onEvaluation: (evaluation) => evaluations.push(evaluation),
			source: sourceOf([
				{ found: true, reason: "targeting_match", value: 3, variant: "small" },
				{ found: false, reason: "notFound" },
				{ found: true, value: "wrong" },
			]),
		});
		await featureFlags.ready;
		const handle = featureFlags.context({ actor: { id: "jane@example.com" } });
		await handle.get("itemLimit");
		await handle.get("itemLimit");
		await handle.get("itemLimit");
		expect(evaluations).toEqual([
			{
				fallbackReason: null,
				flag: "itemLimit",
				key: "item-limit",
				reason: "targeting_match",
				value: 3,
				variant: "small",
			},
			{
				fallbackReason: "notFound",
				flag: "itemLimit",
				key: "item-limit",
				reason: null,
				value: 10,
				variant: null,
			},
			{
				fallbackReason: "wrongType",
				flag: "itemLimit",
				key: "item-limit",
				reason: null,
				value: 10,
				variant: null,
			},
		]);
		expect(JSON.stringify(evaluations)).not.toContain("jane");
	});

	it("drops the service's variant when the value it served was rejected", async () => {
		const evaluations: FeatureFlagEvaluation[] = [];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onEvaluation: (evaluation) => evaluations.push(evaluation),
			source: sourceOf([
				{ found: true, reason: "targeting_match", value: "zzz", variant: "b" },
			]),
		});
		await featureFlags.ready;
		await featureFlags.context({}).get("itemLimit");
		expect(evaluations[0]).toMatchObject({
			fallbackReason: "wrongType",
			reason: null,
			variant: null,
		});
	});

	it("does not log a late failure of a read that began before the outage ended, or any after close", async () => {
		const events: string[] = [];
		let failSlow: (read: FeatureFlagRead) => void = () => undefined;
		const reads: Array<() => Promise<FeatureFlagRead>> = [
			() => new Promise((resolve) => (failSlow = resolve)),
			() => Promise.resolve({ found: false, reason: "vendorError" }),
			() => Promise.resolve({ found: true, value: 4 }),
			() => Promise.resolve({ found: false, reason: "vendorError" }),
		];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onFallback: ({ reason }) => events.push(reason),
			onRecovered: () => events.push("recovered"),
			source: {
				close: () => Promise.resolve(),
				read: () =>
					reads.shift()?.() ?? Promise.resolve({ found: true, value: 3 }),
				ready: Promise.resolve("connected"),
			},
		});
		await featureFlags.ready;
		const handle = featureFlags.context({});
		const slow = handle.get("itemLimit");
		await handle.get("itemLimit"); // down
		await handle.get("itemLimit"); // recovered
		failSlow({ found: false, reason: "vendorError" });
		await slow;
		expect(events).toEqual(["vendorError", "recovered"]);
		const late = handle.get("itemLimit");
		await featureFlags.close();
		await late;
		expect(events).toEqual(["vendorError", "recovered"]);
	});

	it("survives a recorder and a recovered hook that throw", async () => {
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onEvaluation: () => {
				throw new Error("recorder");
			},
			onRecovered: () => Promise.reject(new Error("logger")),
			source: sourceOf([
				{ found: false, reason: "vendorError" },
				{ found: true, value: 4 },
			]),
		});
		await featureFlags.ready;
		const handle = featureFlags.context({});
		expect(await handle.get("itemLimit")).toBe(10);
		expect(await handle.get("itemLimit")).toBe(4);
	});
});

describe("featureFlagsClientCreate with misbehaving subscribers and sources", () => {
	it("keeps notifying the others, and resolves contextSet, when a subscriber throws", async () => {
		const { client, source } = clientOpen();
		await client.ready;
		const other: string[] = [];
		expect(client.flags.get("itemLimit")).toBe(3);
		expect(client.flags.get("checkoutRedesign")).toBe(false);
		client.flags.subscribe("itemLimit", () => {
			throw new Error("subscriber");
		});
		client.flags.subscribe("checkoutRedesign", () => {
			other.push("changed");
		});
		source.valuesSet(() => ({ "checkout-redesign": true, "item-limit": 4 }));
		await expect(client.contextSet({})).resolves.toBeUndefined();
		expect(client.flags.get("itemLimit")).toBe(4);
		expect(client.flags.get("checkoutRedesign")).toBe(true);
		expect(other).toHaveLength(1);
	});

	it("unsubscribes one subscription at a time, even for the same function", async () => {
		const { client, source } = clientOpen();
		await client.ready;
		const calls: string[] = [];
		const listener = () => {
			calls.push("changed");
		};
		client.flags.get("itemLimit");
		const first = client.flags.subscribe("itemLimit", listener);
		client.flags.subscribe("itemLimit", listener);
		first();
		source.valuesSet(() => ({ "item-limit": 4 }));
		expect(calls).toHaveLength(1);
	});

	it("returns the fallback when the source throws, and keeps going", async () => {
		const fallbacks: unknown[] = [];
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			onFallback: (fallback) => fallbacks.push(fallback),
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
		expect(fallbacks).toEqual([
			{ flag: "itemLimit", key: "item-limit", reason: "vendorError" },
		]);
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

describe("featureFlagsServerCreate recovery", () => {
	const down: FeatureFlagRead = { found: false, reason: "vendorError" };

	it("counts an answer that is not a vendor error as the end of an outage", async () => {
		const events: string[] = [];
		const reads: FeatureFlagRead[] = [
			down,
			{ found: false, reason: "notFound" },
		];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onFallback: ({ reason }) => events.push(reason),
			onRecovered: () => events.push("recovered"),
			source: {
				close: () => Promise.resolve(),
				read: () => Promise.resolve(reads.shift() ?? down),
				ready: Promise.resolve("connected"),
			},
		});
		await featureFlags.ready;
		const handle = featureFlags.context({});
		await handle.get("itemLimit");
		await handle.get("itemLimit");
		expect(events).toEqual(["vendorError", "recovered", "notFound"]);
	});

	it("does not end an outage with a read that began before it started", async () => {
		const events: string[] = [];
		let answerSlow: (read: FeatureFlagRead) => void = () => undefined;
		const reads: Array<() => Promise<FeatureFlagRead>> = [
			() => new Promise((resolve) => (answerSlow = resolve)),
			() => Promise.resolve(down),
		];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onFallback: ({ reason }) => events.push(reason),
			onRecovered: () => events.push("recovered"),
			source: {
				close: () => Promise.resolve(),
				read: () =>
					reads.shift()?.() ?? Promise.resolve({ found: true, value: 3 }),
				ready: Promise.resolve("connected"),
			},
		});
		await featureFlags.ready;
		const handle = featureFlags.context({});
		const slow = handle.get("itemLimit");
		await handle.get("itemLimit");
		answerSlow({ found: true, value: 4 });
		expect(await slow).toBe(4);
		expect(events).toEqual(["vendorError"]);
		expect(await handle.get("itemLimit")).toBe(3);
		expect(events).toEqual(["vendorError", "recovered"]);
	});

	it("does not report a recovery that finishes after close", async () => {
		const events: string[] = [];
		let answerSlow: (read: FeatureFlagRead) => void = () => undefined;
		const reads: Array<() => Promise<FeatureFlagRead>> = [
			() => Promise.resolve(down),
			() => new Promise((resolve) => (answerSlow = resolve)),
		];
		const featureFlags = featureFlagsServerCreate({
			flags: featureFlagsTestDefs,
			onFallback: ({ reason }) => events.push(reason),
			onRecovered: () => events.push("recovered"),
			source: {
				close: () => Promise.resolve(),
				read: () => reads.shift()?.() ?? Promise.resolve(down),
				ready: Promise.resolve("connected"),
			},
		});
		await featureFlags.ready;
		const handle = featureFlags.context({});
		await handle.get("itemLimit");
		const slow = handle.get("itemLimit");
		await featureFlags.close();
		answerSlow({ found: true, value: 4 });
		await slow;
		expect(events).toEqual(["vendorError"]);
	});
});

describe("featureFlagsClientCreate lifecycle", () => {
	type Spy = {
		readonly calls: string[];
		readonly emit: () => void;
		readonly set: (value: number) => void;
		readonly source: FeatureFlagsClientSource;
	};
	const spyOpen = (ready: Promise<"connected">): Spy => {
		const calls: string[] = [];
		let value = 3;
		let listener: () => void = () => undefined;
		return {
			calls,
			emit: () => listener(),
			set: (next) => {
				value = next;
			},
			source: {
				close: () => {
					calls.push("close");
					return Promise.resolve();
				},
				contextSet: () => {
					calls.push("contextSet");
					return Promise.resolve();
				},
				read: () => ({ found: true, value }),
				ready,
				subscribe: (next) => {
					listener = next;
					return () => {
						calls.push("unsubscribe");
					};
				},
			},
		};
	};

	it("settles ready as failed when the source's ready rejects, and then reads and notifies", async () => {
		let value = 3;
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			source: {
				close: () => Promise.resolve(),
				contextSet: () => Promise.resolve(),
				read: () => ({ found: true, value }),
				ready: Promise.reject(new Error("ready")),
				subscribe: () => () => undefined,
			},
		});
		const heard: string[] = [];
		expect(client.flags.get("itemLimit")).toBe(10);
		client.flags.subscribe("itemLimit", () => heard.push("changed"));
		value = 4;
		expect(await client.ready).toBe("failed");
		expect(client.flags.get("itemLimit")).toBe(4);
		expect(heard).toEqual(["changed"]);
	});

	it("tells subscribers when ready settles and the value turns out to differ", async () => {
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			source: spyOpen(Promise.resolve("connected")).source,
		});
		const heard: string[] = [];
		expect(client.flags.get("itemLimit")).toBe(10);
		client.flags.subscribe("itemLimit", () => heard.push("changed"));
		await client.ready;
		expect(client.flags.get("itemLimit")).toBe(3);
		expect(heard).toEqual(["changed"]);
	});

	it("refreshes after contextSet even when the source does not emit", async () => {
		const spy = spyOpen(Promise.resolve("connected"));
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			source: spy.source,
		});
		await client.ready;
		expect(client.flags.get("itemLimit")).toBe(3);
		spy.set(8);
		await client.contextSet({});
		expect(client.flags.get("itemLimit")).toBe(8);
	});

	it("closes once: unsubscribes from the source, closes it, and ignores later events and contextSet", async () => {
		const spy = spyOpen(Promise.resolve("connected"));
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			source: spy.source,
		});
		await client.ready;
		const heard: string[] = [];
		expect(client.flags.get("itemLimit")).toBe(3);
		client.flags.subscribe("itemLimit", () => heard.push("changed"));
		await client.close();
		await client.close();
		expect(spy.calls).toEqual(["unsubscribe", "close"]);
		spy.set(9);
		spy.emit();
		await client.contextSet({});
		expect(spy.calls).toEqual(["unsubscribe", "close"]);
		expect(client.flags.get("itemLimit")).toBe(3);
		expect(heard).toEqual([]);
		expect(
			client.flags.subscribe("itemLimit", () => heard.push("late")),
		).toBeTypeOf("function");
	});

	it("reads a flag that is not defined as undefined, and reports it as notFound with no key", async () => {
		const fallbacks: unknown[] = [];
		const client = featureFlagsClientCreate({
			flags: featureFlagsTestDefs,
			onFallback: (fallback) => fallbacks.push(fallback),
			source: spyOpen(Promise.resolve("connected")).source,
		});
		await client.ready;
		// boundary: a flag name that the definitions do not hold
		expect(client.flags.get("nope" as "itemLimit")).toBeUndefined();
		expect(fallbacks).toEqual([{ flag: "nope", key: "", reason: "notFound" }]);
	});
});
