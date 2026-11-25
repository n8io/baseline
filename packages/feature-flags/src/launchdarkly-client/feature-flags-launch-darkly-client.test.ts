import type { EvaluationContext } from "@openfeature/web-sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { featureFlagsClientContractRun } from "../core/feature-flags-client.contract.ts";
import { featureFlagsClientCreate } from "../core/feature-flags-client.ts";
import { featureFlagsContextFreeze } from "../core/feature-flags-context.ts";
import { featureFlagsDefine } from "../core/feature-flags-define.ts";
import type { FeatureFlagFallback } from "../core/feature-flags-resolve.ts";
import {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "../core/feature-flags-test-fixtures.ts";
import { featureFlagsLaunchDarklyClientProviderCreate } from "./feature-flags-launch-darkly-client.ts";
import { featureFlagsLaunchDarklyClientContextTranslate } from "./feature-flags-launch-darkly-client-context.ts";
import { FakeProvider } from "./feature-flags-launch-darkly-client-fake.ts";
import { featureFlagsLaunchDarklyClientSourceCreate } from "./feature-flags-launch-darkly-client-source.ts";

const actorA = featureFlagsContextFreeze({ actor: { id: "a1" } });

// The fake provider sees the translated context; the contract's values read the resolved one.
const resolvedOf = (context: EvaluationContext) => {
	const entry = context["kind"] === "multi" ? context["actor"] : context;
	const id =
		typeof entry === "object" && entry !== null
			? (entry as { targetingKey?: string }).targetingKey
			: undefined;
	return id === undefined ? {} : { actor: { id } };
};

const domainOf = (): string => `ld-client-test-${crypto.randomUUID()}`;

const sourceOf = ({
	provider,
	readyTimeoutMs = 2000,
}: {
	provider: FakeProvider;
	readyTimeoutMs?: number | undefined;
}) =>
	featureFlagsLaunchDarklyClientSourceCreate({
		context: actorA,
		domain: domainOf(),
		provider,
		readyTimeoutMs,
	});

const clientOf = ({
	onFallback = () => undefined,
	provider,
	readyTimeoutMs,
}: {
	onFallback?: (fallback: FeatureFlagFallback) => void;
	provider: FakeProvider;
	readyTimeoutMs?: number | undefined;
}) =>
	featureFlagsClientCreate({
		flags: featureFlagsTestDefs,
		kinds: featureFlagsTestKinds,
		onFallback,
		source: sourceOf({ provider, readyTimeoutMs }),
	});

// The shared contract, against the OpenFeature web SDK and a fake LaunchDarkly provider.
featureFlagsClientContractRun({
	create: ({ onFallback, values }) => {
		const provider = new FakeProvider({
			values: (context) => values(resolvedOf(context)),
		});
		return {
			client: clientOf({ onFallback, provider }),
			valuesSet: (next) =>
				provider.valuesSet((context) => next(resolvedOf(context))),
		};
	},
	name: "launchdarkly browser",
});

describe("featureFlagsLaunchDarklyClientContextTranslate", () => {
	it("turns one kind into a single-kind context and several into a multi-kind one", () => {
		expect(
			featureFlagsLaunchDarklyClientContextTranslate(
				featureFlagsContextFreeze({
					actor: { attributes: { plan: "pro" }, id: "a1" },
				}),
			),
		).toEqual({ kind: "actor", plan: "pro", targetingKey: "a1" });
		expect(
			featureFlagsLaunchDarklyClientContextTranslate(
				featureFlagsContextFreeze({
					actor: { id: "a1" },
					customer: { attributes: { seats: 3 }, id: "c9" },
				}),
			),
		).toEqual({
			actor: { targetingKey: "a1" },
			customer: { seats: 3, targetingKey: "c9" },
			kind: "multi",
		});
	});

	it("lets the id win over an attribute named targetingKey, and no kind is anonymous", () => {
		expect(
			featureFlagsLaunchDarklyClientContextTranslate(
				featureFlagsContextFreeze({
					actor: { attributes: { targetingKey: "x" }, id: "a1" },
				}),
			),
		).toMatchObject({ targetingKey: "a1" });
		expect(
			featureFlagsLaunchDarklyClientContextTranslate(
				featureFlagsContextFreeze({}),
			),
		).toEqual({ anonymous: true, targetingKey: "" });
	});
});

describe("featureFlagsLaunchDarklyClientProviderCreate", () => {
	it("forces streaming on, even when the vendor options turn it off", () => {
		const provider = featureFlagsLaunchDarklyClientProviderCreate({
			clientSideId: "id",
			vendor: { streaming: false } as never,
		});
		expect(
			(provider as unknown as { ldOptions: { streaming: boolean } }).ldOptions
				.streaming,
		).toBe(true);
	});

	it("passes other vendor options through", () => {
		const provider = featureFlagsLaunchDarklyClientProviderCreate({
			clientSideId: "id",
			vendor: { sendEvents: false },
		});
		expect(
			(provider as unknown as { ldOptions: { sendEvents: boolean } }).ldOptions
				.sendEvents,
		).toBe(false);
	});
});

describe("the LaunchDarkly browser source", () => {
	it("settles failed when the provider cannot start, and reads fallbacks", async () => {
		const fallbacks: FeatureFlagFallback[] = [];
		const client = clientOf({
			onFallback: (fallback) => fallbacks.push(fallback),
			provider: new FakeProvider({
				initialize: "fail",
				values: () => ({ "item-limit": 3 }),
			}),
		});
		await expect(client.ready).resolves.toBe("failed");
		expect(client.flags.get("itemLimit")).toBe(10);
		expect(fallbacks).toContainEqual({
			flag: "itemLimit",
			key: "item-limit",
			reason: "vendorError",
		});
		await client.close();
	});

	it("settles failed when the provider reports an error without throwing", async () => {
		const client = clientOf({
			provider: new FakeProvider({
				initialize: "error",
				values: () => ({ "item-limit": 3 }),
			}),
		});
		await expect(client.ready).resolves.toBe("failed");
		expect(client.flags.get("itemLimit")).toBe(10);
		await client.close();
	});

	it("settles timeout when the provider is slow, and picks the values up when it connects", async () => {
		const provider = new FakeProvider({
			initialize: "hang",
			values: () => ({ "item-limit": 3 }),
		});
		const client = clientOf({ provider, readyTimeoutMs: 20 });
		await expect(client.ready).resolves.toBe("timeout");
		expect(client.flags.get("itemLimit")).toBe(10);
		const listener = vi.fn();
		client.flags.subscribe("itemLimit", listener);
		provider.readyEmit();
		await vi.waitFor(() => expect(client.flags.get("itemLimit")).toBe(3));
		expect(listener).toHaveBeenCalledTimes(1);
		await client.close();
	});

	it("does not let null or an array pass as an object flag", async () => {
		const fallbacks: FeatureFlagFallback[] = [];
		const provider = new FakeProvider({ values: () => ({ theme: null }) });
		const client = clientOf({
			onFallback: (fallback) => fallbacks.push(fallback),
			provider,
		});
		await client.ready;
		expect(client.flags.get("theme")).toEqual({ mode: "light" });
		provider.valuesSet(() => ({ theme: [] }));
		await vi.waitFor(() => expect(fallbacks).toHaveLength(1));
		expect(client.flags.get("theme")).toEqual({ mode: "light" });
		expect(fallbacks[0]).toMatchObject({
			flag: "theme",
			reason: "wrongType",
		});
		await client.close();
	});

	it("rejects null and an array for an object flag before the schema sees them", async () => {
		const fallbacks: FeatureFlagFallback[] = [];
		const provider = new FakeProvider({ values: () => ({ theme: null }) });
		const client = featureFlagsClientCreate({
			flags: featureFlagsDefine({
				theme: {
					fallback: { any: 1 },
					key: "theme",
					schema: z
						.object({ any: z.number() })
						.or(z.null())
						.or(z.array(z.number())),
				},
			}),
			onFallback: (fallback) => fallbacks.push(fallback),
			source: sourceOf({ provider }),
		});
		await client.ready;
		expect(client.flags.get("theme")).toEqual({ any: 1 });
		provider.valuesSet(() => ({ theme: [1] }));
		await vi.waitFor(() => expect(fallbacks).toHaveLength(1));
		expect(fallbacks[0]).toMatchObject({ flag: "theme", reason: "wrongType" });
		provider.valuesSet(() => ({ theme: { any: 2 } }));
		await vi.waitFor(() =>
			expect(client.flags.get("theme")).toEqual({ any: 2 }),
		);
		await client.close();
	});

	it("closes only its own provider, so another client keeps answering", async () => {
		const one = new FakeProvider({ values: () => ({ "item-limit": 3 }) });
		const two = new FakeProvider({ values: () => ({ "item-limit": 7 }) });
		const first = clientOf({ provider: one });
		const second = clientOf({ provider: two });
		await Promise.all([first.ready, second.ready]);
		await first.close();
		expect(one.closed).toBe(1);
		expect(two.closed).toBe(0);
		expect(second.flags.get("itemLimit")).toBe(7);
		await second.close();
		expect(two.closed).toBe(1);
	});

	it("keeps a context per client", async () => {
		const values = (context: EvaluationContext) => ({
			"item-limit": resolvedOf(context).actor?.id === "b2" ? 9 : 3,
		});
		const first = clientOf({ provider: new FakeProvider({ values }) });
		const second = clientOf({ provider: new FakeProvider({ values }) });
		await Promise.all([first.ready, second.ready]);
		await first.contextSet({ actor: { id: "b2" } });
		await vi.waitFor(() => expect(first.flags.get("itemLimit")).toBe(9));
		expect(second.flags.get("itemLimit")).toBe(3);
		await Promise.all([first.close(), second.close()]);
	});
});
