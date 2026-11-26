import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
	type CacheStore,
	cacheCreate,
	cacheStoreMemoryCreate,
} from "./index.ts";

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
					`cacheCreate: ttlMs must be a positive integer, found ${ttlMs}`,
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
