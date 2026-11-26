import { metrics } from "@opentelemetry/api";
import {
	AggregationTemporality,
	InMemoryMetricExporter,
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	type CacheStore,
	cacheCreate,
	cacheStoreMemoryCreate,
} from "./index.ts";

// The global meter provider, with an in-memory exporter the tests read what was counted from.
const metricExporter = new InMemoryMetricExporter(AggregationTemporality.DELTA);
const metricReader = new PeriodicExportingMetricReader({
	exporter: metricExporter,
	exportIntervalMillis: 60_000,
});
metrics.setGlobalMeterProvider(new MeterProvider({ readers: [metricReader] }));

// The store error counters exported since the last call, flattened to their data points.
const storeErrorsTake = async () => {
	await metricReader.forceFlush();
	const taken = metricExporter
		.getMetrics()
		.flatMap((resource) => resource.scopeMetrics)
		.flatMap((scope) =>
			scope.metrics.map((metric) => ({
				description: metric.descriptor.description,
				name: metric.descriptor.name,
				points: metric.dataPoints.map((point) => ({
					attributes: point.attributes,
					value: point.value,
				})),
				scope: scope.scope.name,
				unit: metric.descriptor.unit,
			})),
		);
	metricExporter.reset();
	return taken;
};

// A memory store whose listed calls fail while `failing` is true.
const storeFlaky = (calls: (keyof CacheStore)[]) => {
	const memory = cacheStoreMemoryCreate();
	const flaky = { failing: true, store: memory };
	const guard = async (call: keyof CacheStore): Promise<void> => {
		if (flaky.failing && calls.includes(call)) throw new Error("Store is down");
	};
	flaky.store = {
		delete: (key) => guard("delete").then(() => memory.delete(key)),
		get: (key) => guard("get").then(() => memory.get(key)),
		set: (entry) => guard("set").then(() => memory.set(entry)),
	};
	return flaky;
};

// A clock and a logger that record, handed to cacheCreate in place of the real ones.
const depsCreate = () => {
	const clock = { at: 0 };
	const warnings: unknown[][] = [];
	return {
		advance: (ms: number) => {
			clock.at += ms;
		},
		deps: {
			logger: { warn: (...args: unknown[]) => void warnings.push(args) },
			now: () => clock.at,
		},
		warnings,
	};
};

// First in the file on purpose: the counter is made on the first failure, so this test is the one
// Stryker runs against a mutant of its name, scope, description or unit.
describe("cacheCreate store failures, by operation", () => {
	it.each(["delete", "get", "set"] as const)(
		"a failed %s warns with that operation and counts one store error",
		async (operation) => {
			await storeErrorsTake();
			const { deps, warnings } = depsCreate();
			const { store } = storeFlaky([operation]);
			const cache = cacheCreate(store, {
				...deps,
				prefix: "foo",
				schema: z.string(),
			});

			if (operation === "get") await cache.get("foo_1");
			if (operation === "set") await cache.set("foo_1", "First");
			if (operation === "delete") await cache.delete("foo_1");

			expect(warnings).toEqual([
				[
					expect.objectContaining({ operation, prefix: "foo" }),
					"Cache store failed; serving without the cache",
				],
			]);
			expect(await storeErrorsTake()).toEqual([
				{
					description: "Cache store calls that failed and were not rethrown",
					name: "baseline.cache.store_errors",
					points: [
						{
							attributes: {
								"baseline.cache.operation": operation,
								"baseline.cache.prefix": "foo",
							},
							value: 1,
						},
					],
					scope: "@n8io/baseline-cache",
					unit: "{call}",
				},
			]);
		},
	);

	it("a failed delete of one id does not lift the miss on another id's failed delete", async () => {
		const { deps } = depsCreate();
		const flaky = storeFlaky(["delete"]);
		const cache = cacheCreate(flaky.store, {
			...deps,
			prefix: "foo",
			schema: z.string(),
			ttlMs: 1000,
		});
		await cache.set("foo_1", "One");
		await cache.set("foo_2", "Two");

		await cache.delete("foo_1");
		await cache.delete("foo_2");
		flaky.failing = false;

		expect(await cache.get("foo_1")).toBeUndefined();
		expect(await cache.get("foo_2")).toBeUndefined();
	});
});

describe("cacheCreate on a failing store", () => {
	it("get is a miss, and set and delete resolve", async () => {
		const { deps, warnings } = depsCreate();
		const { store } = storeFlaky(["delete", "get", "set"]);
		const cache = cacheCreate(store, {
			...deps,
			prefix: "foo",
			schema: z.string(),
		});

		expect(await cache.get("foo_1")).toBeUndefined();
		expect(await cache.set("foo_1", "First")).toBeUndefined();
		expect(await cache.delete("foo_1")).toBeUndefined();
		expect(warnings).toEqual([
			[
				expect.objectContaining({
					err: new Error("Store is down"),
					operation: "get",
					prefix: "foo",
				}),
				"Cache store failed; serving without the cache",
			],
		]);
	});

	it("warns once per 30 s, with how many failures went unlogged", async () => {
		const { advance, deps, warnings } = depsCreate();
		const { store } = storeFlaky(["get"]);
		const cache = cacheCreate(store, {
			...deps,
			prefix: "foo",
			schema: z.string(),
		});

		for (let call = 0; call < 5; call += 1) await cache.get("foo_1");
		expect(warnings).toHaveLength(1);

		advance(30_000);
		await cache.get("foo_1");
		expect(warnings).toHaveLength(2);
		expect(warnings.at(-1)).toEqual([
			expect.objectContaining({ unlogged: 4 }),
			expect.any(String),
		]);
	});

	it("after a failed delete this process reads a miss until the entry has expired", async () => {
		const { advance, deps } = depsCreate();
		const flaky = storeFlaky(["delete"]);
		const cache = cacheCreate(flaky.store, {
			...deps,
			prefix: "foo",
			schema: z.string(),
			ttlMs: 1000,
		});
		await cache.set("foo_1", "Old");
		await cache.set("foo_2", "Other");

		await cache.delete("foo_1");
		flaky.failing = false;

		// The store still holds it, and would hand it to another process.
		expect(await flaky.store.get("foo:foo_1")).toBe('"Old"');
		expect(await cache.get("foo_1")).toBeUndefined();
		expect(await cache.get("foo_2")).toBe("Other");

		// Rewritten by this process after the delete: still not trusted before the mark ends.
		await cache.set("foo_1", "New");
		advance(999);
		expect(await cache.get("foo_1")).toBeUndefined();
		advance(1);
		await cache.set("foo_1", "Newer");
		expect(await cache.get("foo_1")).toBe("Newer");
	});

	it("after a failed set this process reads a miss, not the entry it meant to replace", async () => {
		const { deps } = depsCreate();
		const flaky = storeFlaky(["set"]);
		const cache = cacheCreate(flaky.store, {
			...deps,
			prefix: "foo",
			schema: z.string(),
		});
		flaky.failing = false;
		await cache.set("foo_1", "Old");
		flaky.failing = true;

		await cache.set("foo_1", "New");

		expect(await flaky.store.get("foo:foo_1")).toBe('"Old"');
		expect(await cache.get("foo_1")).toBeUndefined();
	});

	it('with onStoreError "throw" every call rejects with the store\'s error', async () => {
		const { deps, warnings } = depsCreate();
		const { store } = storeFlaky(["delete", "get", "set"]);
		const cache = cacheCreate(store, {
			...deps,
			onStoreError: "throw",
			prefix: "foo",
			schema: z.string(),
		});

		await expect(cache.get("foo_1")).rejects.toThrow("Store is down");
		await expect(cache.set("foo_1", "First")).rejects.toThrow("Store is down");
		await expect(cache.delete("foo_1")).rejects.toThrow("Store is down");
		expect(warnings).toEqual([]);
	});
});

describe("cacheCreate on what the store holds", () => {
	// A store that answers every get with the same text.
	const storeHolding = (json: string | undefined): CacheStore => ({
		delete: async () => {},
		get: async () => json,
		set: async () => {},
	});

	it("reads text that is not JSON as a miss", async () => {
		const cache = cacheCreate(storeHolding("{not json"), {
			prefix: "foo",
			schema: z.string(),
		});

		expect(await cache.get("foo_1")).toBeUndefined();
	});

	it("does not run the schema on a miss, so a schema with a default cannot make one up", async () => {
		const cache = cacheCreate(storeHolding(undefined), {
			prefix: "foo",
			schema: z.string().default("made up"),
		});

		expect(await cache.get("foo_1")).toBeUndefined();
	});

	it("reads a value the schema refuses as a miss, whatever the refusal carries", async () => {
		const refusing: StandardSchemaV1<unknown, string> = {
			"~standard": {
				validate: () =>
					({ issues: [{ message: "No" }], value: "leaked" }) as never,
				vendor: "test",
				version: 1,
			},
		};
		const cache = cacheCreate(storeHolding('"First"'), {
			prefix: "foo",
			schema: refusing,
		});

		expect(await cache.get("foo_1")).toBeUndefined();
	});
});

describe("cacheCreate options", () => {
	it.each([0, -1, 1.5, Number.NaN])(
		"throws a TypeError for ttlMs %s",
		(ttlMs) => {
			expect(() =>
				cacheCreate(cacheStoreMemoryCreate(), {
					prefix: "foo",
					schema: z.string(),
					ttlMs,
				}),
			).toThrow(
				new TypeError(
					`cacheCreate: ttlMs must be a whole number, 1 or more, found ${ttlMs}`,
				),
			);
		},
	);

	it("throws a TypeError for an empty prefix", () => {
		expect(() =>
			cacheCreate(cacheStoreMemoryCreate(), { prefix: "", schema: z.string() }),
		).toThrow(new TypeError("cacheCreate: prefix must not be empty"));
	});

	it("throws a TypeError for an unknown onStoreError", () => {
		expect(() =>
			cacheCreate(cacheStoreMemoryCreate(), {
				onStoreError: "ignore" as "miss",
				prefix: "foo",
				schema: z.string(),
			}),
		).toThrow(
			new TypeError(
				'cacheCreate: onStoreError must be "miss" or "throw", found "ignore"',
			),
		);
	});

	it("accepts null for ttlMs and onStoreError", () => {
		expect(() =>
			cacheCreate(cacheStoreMemoryCreate(), {
				onStoreError: null,
				prefix: "foo",
				schema: z.string(),
				ttlMs: null,
			}),
		).not.toThrow();
	});
});
