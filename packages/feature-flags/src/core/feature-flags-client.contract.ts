import { describe, expect, it } from "vitest";
import type { FeatureFlagsClient } from "./feature-flags-client-types.ts";
import type { FeatureFlagContextResolved } from "./feature-flags-context.ts";
import type { FeatureFlagFallback } from "./feature-flags-resolve-types.ts";
import type {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "./feature-flags-test-fixtures.ts";

type Defs = typeof featureFlagsTestDefs;
type Kinds = typeof featureFlagsTestKinds;

/** Raw values by flag key, chosen from the context a client currently holds. */
export type FeatureFlagsClientContractValues = (
	context: FeatureFlagContextResolved,
) => Readonly<Record<string, unknown>>;

/** What an adapter's contract run supplies: its client, and a way to change what it serves. */
export type FeatureFlagsClientContractHarness = {
	/** Builds the adapter's client for `{ actor: { id: "a1" } }` serving these raw values. */
	create(input: {
		onFallback(fallback: FeatureFlagFallback): void;
		values: FeatureFlagsClientContractValues;
	}): {
		readonly client: FeatureFlagsClient<Defs, Kinds>;
		/** Changes what the flag service serves, as it would push a change. May be async. */
		valuesSet(values: FeatureFlagsClientContractValues): Promise<void> | void;
	};
	readonly name: string;
};

const actorA = { actor: { id: "a1" } } as const;
const actorB = { actor: { id: "b2" } } as const;

/**
 * The cases every browser adapter passes: fallbacks before ready, wrong types, a missing flag,
 * stable snapshots, subscribers called only for flags that changed, and a context replaced whole.
 * The memory client and the LaunchDarkly browser adapter run the same cases.
 */
export const featureFlagsClientContractRun = (
	harness: FeatureFlagsClientContractHarness,
): void => {
	const open = async (values: FeatureFlagsClientContractValues) => {
		const fallbacks: FeatureFlagFallback[] = [];
		const opened = harness.create({
			onFallback: (fallback) => {
				fallbacks.push(fallback);
			},
			values,
		});
		await opened.client.ready;
		return { ...opened, fallbacks };
	};

	describe(`feature flags client contract: ${harness.name}`, () => {
		it("returns the fallback before ready settles", async () => {
			const { client } = harness.create({
				onFallback: () => undefined,
				values: () => ({ "item-limit": 3 }),
			});
			expect(client.flags.get("itemLimit")).toBe(10);
			await client.ready;
			await expect.poll(() => client.flags.get("itemLimit")).toBe(3);
			await client.close();
		});

		it("returns the fallback and logs it for a wrong type, a value outside values and a missing flag", async () => {
			const { client, fallbacks } = await open(() => ({
				"hero-copy": "loud",
				"item-limit": "ten",
			}));
			expect(client.flags.get("itemLimit")).toBe(10);
			expect(client.flags.get("heroCopy")).toBe("plain");
			expect(client.flags.get("checkoutRedesign")).toBe(false);
			expect(fallbacks).toEqual([
				{ flag: "itemLimit", key: "item-limit", reason: "wrongType" },
				{ flag: "heroCopy", key: "hero-copy", reason: "notInValues" },
				{
					flag: "checkoutRedesign",
					key: "checkout-redesign",
					reason: "notFound",
				},
			]);
			await client.close();
		});

		it("returns the same reference until the value changes", async () => {
			const { client, valuesSet } = await open(() => ({
				"item-limit": 3,
				theme: { mode: "dark" },
			}));
			const first = client.flags.get("theme");
			expect(client.flags.get("theme")).toBe(first);
			await valuesSet(() => ({ "item-limit": 4, theme: { mode: "dark" } }));
			await expect.poll(() => client.flags.get("itemLimit")).toBe(4);
			expect(client.flags.get("theme")).toBe(first);
			await valuesSet(() => ({ "item-limit": 4, theme: { mode: "light" } }));
			await expect
				.poll(() => client.flags.get("theme"))
				.toEqual({ mode: "light" });
			expect(client.flags.get("theme")).not.toBe(first);
			await client.close();
		});

		it("calls a subscriber only when its own flag changed, and not after it unsubscribes", async () => {
			const { client, valuesSet } = await open(() => ({
				"checkout-redesign": false,
				"item-limit": 3,
			}));
			const limit: string[] = [];
			const checkout: string[] = [];
			client.flags.get("itemLimit");
			client.flags.get("checkoutRedesign");
			const unsubscribe = client.flags.subscribe("itemLimit", () => {
				limit.push("changed");
			});
			client.flags.subscribe("checkoutRedesign", () => {
				checkout.push("changed");
			});
			await valuesSet(() => ({ "checkout-redesign": true, "item-limit": 3 }));
			await expect.poll(() => checkout.length).toBe(1);
			expect(limit).toEqual([]);
			unsubscribe();
			await valuesSet(() => ({ "checkout-redesign": true, "item-limit": 9 }));
			await expect.poll(() => client.flags.get("itemLimit")).toBe(9);
			expect(limit).toEqual([]);
			await client.close();
		});

		it("replaces the whole context and tells the subscribers of flags that changed", async () => {
			const { client } = harness.create({
				onFallback: () => undefined,
				values: (context) => ({
					"checkout-redesign": context["actor"]?.id === "b2",
					"item-limit": 3,
				}),
			});
			await client.ready;
			const checkout: string[] = [];
			const limit: string[] = [];
			expect(client.flags.get("checkoutRedesign")).toBe(false);
			expect(client.flags.get("itemLimit")).toBe(3);
			client.flags.subscribe("checkoutRedesign", () => {
				checkout.push("changed");
			});
			client.flags.subscribe("itemLimit", () => {
				limit.push("changed");
			});
			await client.contextSet(actorB);
			await expect.poll(() => checkout.length).toBe(1);
			expect(client.flags.get("checkoutRedesign")).toBe(true);
			expect(limit).toEqual([]);
			await client.contextSet(actorA);
			await expect.poll(() => checkout.length).toBe(2);
			expect(client.flags.get("checkoutRedesign")).toBe(false);
			await client.close();
		});

		it("closes twice, drops subscribers, and ready never rejects", async () => {
			const { client, valuesSet } = await open(() => ({ "item-limit": 3 }));
			const listener: string[] = [];
			client.flags.get("itemLimit");
			client.flags.subscribe("itemLimit", () => {
				listener.push("changed");
			});
			await client.close();
			await client.close();
			await valuesSet(() => ({ "item-limit": 4 }));
			await expect(client.ready).resolves.toBeTypeOf("string");
			expect(listener).toEqual([]);
		});
	});
};
