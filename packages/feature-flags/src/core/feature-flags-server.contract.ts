import { describe, expect, it } from "vitest";
import type {
	FeatureFlagFallback,
	FeatureFlagsReadyStatus,
} from "./feature-flags-resolve.ts";
import type { FeatureFlags } from "./feature-flags-server.ts";
import type {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "./feature-flags-test-fixtures.ts";

type Defs = typeof featureFlagsTestDefs;
type Kinds = typeof featureFlagsTestKinds;

/** What an adapter's contract run supplies: its flags, loaded with raw values by flag key. */
export type FeatureFlagsServerContractHarness = {
	/** Builds the adapter's flags with these raw values (any type) loaded under their keys. */
	create(input: {
		onFallback(fallback: FeatureFlagFallback): void;
		values: Readonly<Record<string, unknown>>;
	}): FeatureFlags<Defs, Kinds>;
	readonly name: string;
};

const actor = { actor: { id: "a1" } } as const;

/**
 * The cases every server adapter passes: fallbacks before ready, wrong types, values outside
 * `values`, a failing schema, a missing flag, and a closed instance. The memory flags and the
 * LaunchDarkly adapter run the same cases.
 */
export const featureFlagsServerContractRun = (
	harness: FeatureFlagsServerContractHarness,
): void => {
	const open = async (values: Readonly<Record<string, unknown>>) => {
		const fallbacks: FeatureFlagFallback[] = [];
		const featureFlags = harness.create({
			onFallback: (fallback) => {
				fallbacks.push(fallback);
			},
			values,
		});
		const status: FeatureFlagsReadyStatus = await featureFlags.ready;
		return { fallbacks, featureFlags, status };
	};

	describe(`feature flags server contract: ${harness.name}`, () => {
		it("returns the fallback before ready settles, and never waits", async () => {
			const featureFlags = harness.create({
				onFallback: () => undefined,
				values: { "item-limit": 3 },
			});
			const before = await featureFlags.context(actor).get("itemLimit");
			expect(before).toBe(10);
			await featureFlags.close();
		});

		it("settles ready as connected and returns each flag's value", async () => {
			const { featureFlags, status } = await open({
				"checkout-redesign": true,
				"hero-copy": "bold",
				"item-limit": 3,
				theme: { mode: "dark" },
			});
			const handle = featureFlags.context(actor);
			expect(status).toBe("connected");
			expect(await handle.get("checkoutRedesign")).toBe(true);
			expect(await handle.get("heroCopy")).toBe("bold");
			expect(await handle.get("itemLimit")).toBe(3);
			expect(await handle.get("theme")).toEqual({ mode: "dark" });
			await featureFlags.close();
		});

		it("returns the fallback and logs it for a value of the wrong type", async () => {
			const { fallbacks, featureFlags } = await open({
				"checkout-redesign": "yes",
				"item-limit": "ten",
			});
			const handle = featureFlags.context(actor);
			expect(await handle.get("itemLimit")).toBe(10);
			expect(await handle.get("checkoutRedesign")).toBe(false);
			expect(fallbacks).toEqual([
				{ flag: "itemLimit", key: "item-limit", reason: "wrongType" },
				{
					flag: "checkoutRedesign",
					key: "checkout-redesign",
					reason: "wrongType",
				},
			]);
			await featureFlags.close();
		});

		it("returns the fallback for a value outside values or failing its schema", async () => {
			const { fallbacks, featureFlags } = await open({
				"hero-copy": "loud",
				theme: { mode: "neon" },
			});
			const handle = featureFlags.context(actor);
			expect(await handle.get("heroCopy")).toBe("plain");
			expect(await handle.get("theme")).toEqual({ mode: "light" });
			expect(fallbacks.map(({ reason }) => reason)).toEqual([
				"notInValues",
				"schemaFailed",
			]);
			await featureFlags.close();
		});

		it("returns the fallback for a flag the service does not have, and logs it once", async () => {
			const { fallbacks, featureFlags } = await open({});
			const handle = featureFlags.context(actor);
			expect(await handle.get("itemLimit")).toBe(10);
			expect(await handle.get("itemLimit")).toBe(10);
			expect(fallbacks).toEqual([
				{ flag: "itemLimit", key: "item-limit", reason: "notFound" },
			]);
			await featureFlags.close();
		});

		it("returns fallbacks after close, closes twice, and ready never rejects", async () => {
			const { featureFlags } = await open({ "item-limit": 3 });
			await featureFlags.close();
			await featureFlags.close();
			expect(await featureFlags.context(actor).get("itemLimit")).toBe(10);
			await expect(featureFlags.ready).resolves.toBeTypeOf("string");
		});
	});
};
