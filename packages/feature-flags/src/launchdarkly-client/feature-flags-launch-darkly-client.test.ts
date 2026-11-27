import {
	ErrorCode,
	type EvaluationContext,
	type ResolutionDetails,
} from "@openfeature/web-sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { featureFlagsClientContractRun } from "../core/feature-flags-client.contract.ts";
import { featureFlagsClientCreate } from "../core/feature-flags-client.ts";
import { featureFlagsContextFreeze } from "../core/feature-flags-context.ts";
import { featureFlagsDefine } from "../core/feature-flags-define.ts";
import type { FeatureFlagFallback } from "../core/feature-flags-resolve-types.ts";
import {
	featureFlagsTestDefs,
	featureFlagsTestKinds,
} from "../core/feature-flags-test-fixtures.ts";
import {
	featureFlagsLaunchDarklyClientCreate,
	featureFlagsLaunchDarklyClientProviderCreate,
} from "./feature-flags-launch-darkly-client.ts";
import { featureFlagsLaunchDarklyClientContextTranslate } from "./feature-flags-launch-darkly-client-context.ts";
import { featureFlagsLaunchDarklyClientSourceCreate } from "./feature-flags-launch-darkly-client-source.ts";
import { FakeProvider } from "./feature-flags-launch-darkly-client-test-provider.ts";

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
		const listener: string[] = [];
		client.flags.subscribe("itemLimit", () => {
			listener.push("changed");
		});
		provider.readyEmit();
		await expect.poll(() => client.flags.get("itemLimit")).toBe(3);
		expect(listener).toHaveLength(1);
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
		await expect.poll(() => fallbacks.length).toBe(1);
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
		await expect.poll(() => fallbacks.length).toBe(1);
		expect(fallbacks[0]).toMatchObject({ flag: "theme", reason: "wrongType" });
		provider.valuesSet(() => ({ theme: { any: 2 } }));
		await expect.poll(() => client.flags.get("theme")).toEqual({ any: 2 });
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
		await expect.poll(() => first.flags.get("itemLimit")).toBe(9);
		expect(second.flags.get("itemLimit")).toBe(3);
		await Promise.all([first.close(), second.close()]);
	});
});

// A provider that answers every number read with the details it was given.
class DetailsProvider extends FakeProvider {
	private readonly details: Omit<ResolutionDetails<number>, "value">;

	constructor(details: Omit<ResolutionDetails<number>, "value">) {
		super({ values: () => ({}) });
		this.details = details;
	}

	override resolveNumberEvaluation(
		_key: string,
		fallback: number,
	): ResolutionDetails<number> {
		return { ...this.details, value: fallback };
	}
}

describe("the LaunchDarkly browser source's reads", () => {
	const readOf = async ({
		fallback,
		provider,
	}: {
		fallback: unknown;
		provider: FakeProvider;
	}) => {
		const source = sourceOf({ provider });
		await source.ready;
		return source.read({ fallback, key: "k" });
	};

	it("reads a value of each type the fallback names", async () => {
		const provider = new FakeProvider({
			values: () => ({ b: true, n: 3, o: { mode: "dark" }, s: "x" }),
		});
		const source = sourceOf({ provider });
		await expect(source.ready).resolves.toBe("connected");
		expect(source.read({ fallback: false, key: "b" })).toMatchObject({
			found: true,
			value: true,
		});
		expect(source.read({ fallback: 0, key: "n" })).toMatchObject({
			found: true,
			value: 3,
		});
		expect(source.read({ fallback: "", key: "s" })).toMatchObject({
			found: true,
			value: "x",
		});
		expect(source.read({ fallback: {}, key: "o" })).toMatchObject({
			found: true,
			value: { mode: "dark" },
		});
	});

	it("keeps an array as an object flag when its fallback is an array", async () => {
		const provider = new FakeProvider({ values: () => ({ k: [1, 2] }) });
		expect(await readOf({ fallback: [], provider })).toMatchObject({
			found: true,
			value: [1, 2],
		});
	});

	it("reads a missing key as notFound, and a value of the wrong type as wrongType", async () => {
		const provider = new FakeProvider({ values: () => ({ k: "text" }) });
		const source = sourceOf({ provider });
		await source.ready;
		expect(source.read({ fallback: 0, key: "k" })).toStrictEqual({
			found: false,
			reason: "wrongType",
		});
		expect(source.read({ fallback: 0, key: "gone" })).toStrictEqual({
			found: false,
			reason: "notFound",
		});
	});

	it("reads an ERROR reason with no error code as a vendor error", async () => {
		expect(
			await readOf({
				fallback: 0,
				provider: new DetailsProvider({ reason: "ERROR" }),
			}),
		).toStrictEqual({ found: false, reason: "vendorError" });
	});

	it("reads any other error code as a vendor error", async () => {
		expect(
			await readOf({
				fallback: 0,
				provider: new DetailsProvider({
					errorCode: ErrorCode.GENERAL,
					reason: "ERROR",
				}),
			}),
		).toStrictEqual({ found: false, reason: "vendorError" });
	});

	it("reads a vendor error until the provider is ready, even when it says it is", async () => {
		const provider = new FakeProvider({
			initialize: "hang",
			values: () => ({ k: 3 }),
		});
		const source = sourceOf({ provider, readyTimeoutMs: 20 });
		await expect(source.ready).resolves.toBe("timeout");
		expect(source.read({ fallback: 0, key: "k" })).toStrictEqual({
			found: false,
			reason: "vendorError",
		});
	});

	it("stops calling a listener once it unsubscribes", async () => {
		const provider = new FakeProvider({ values: () => ({ k: 3 }) });
		const source = sourceOf({ provider });
		await source.ready;
		const calls: string[] = [];
		const unsubscribe = source.subscribe(() => calls.push("changed"));
		provider.valuesSet(() => ({ k: 4 }));
		await expect.poll(() => calls.length).toBeGreaterThan(0);
		const heard = calls.length;
		unsubscribe();
		provider.valuesSet(() => ({ k: 5 }));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(calls).toHaveLength(heard);
	});
});

describe("featureFlagsLaunchDarklyClientCreate", () => {
	it("opens a client that settles without LaunchDarkly answering, and reads fallbacks through onFallback", async () => {
		const fallbacks: FeatureFlagFallback[] = [];
		const client = featureFlagsLaunchDarklyClientCreate({
			clientSideId: "client-side-id",
			context: { actor: { id: "a1" } },
			flags: featureFlagsTestDefs,
			kinds: featureFlagsTestKinds,
			onFallback: (fallback) => fallbacks.push(fallback),
			readyTimeoutMs: 100,
			vendor: {
				baseUri: "http://127.0.0.1:1",
				eventsUri: "http://127.0.0.1:1",
				sendEvents: false,
				streamUri: "http://127.0.0.1:1",
			},
		});
		expect(["failed", "timeout"]).toContain(await client.ready);
		expect(client.flags.get("itemLimit")).toBe(10);
		expect(fallbacks).toEqual([
			{ flag: "itemLimit", key: "item-limit", reason: "vendorError" },
		]);
		await client.close();
	});
});
