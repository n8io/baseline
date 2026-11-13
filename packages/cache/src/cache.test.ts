import { logger } from "@n8io/baseline-logger";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("cacheCreate on a failing store", () => {
	test("get is a miss, and set and delete resolve", async () => {
		const warn = vi.spyOn(logger, "warn").mockReturnValue();
		const { store } = storeFlaky(["delete", "get", "set"]);
		const cache = cacheCreate(store, { prefix: "foo", schema: z.string() });

		expect(await cache.get("foo_1")).toBeUndefined();
		expect(await cache.set("foo_1", "First")).toBeUndefined();
		expect(await cache.delete("foo_1")).toBeUndefined();
		expect(warn).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				err: new Error("Store is down"),
				operation: "get",
				prefix: "foo",
			}),
			"Cache store failed; serving without the cache",
		);
	});

	test("warns once per 30 s, with how many failures went unlogged", async () => {
		const warn = vi.spyOn(logger, "warn").mockReturnValue();
		const { store } = storeFlaky(["get"]);
		const cache = cacheCreate(store, { prefix: "foo", schema: z.string() });

		for (let call = 0; call < 5; call += 1) await cache.get("foo_1");
		expect(warn).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(30_000);
		await cache.get("foo_1");
		expect(warn).toHaveBeenCalledTimes(2);
		expect(warn).toHaveBeenLastCalledWith(
			expect.objectContaining({ unlogged: 4 }),
			expect.any(String),
		);
	});

	test("after a failed delete this process reads a miss until the entry has expired", async () => {
		vi.spyOn(logger, "warn").mockReturnValue();
		const flaky = storeFlaky(["delete"]);
		const cache = cacheCreate(flaky.store, {
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
		vi.advanceTimersByTime(999);
		expect(await cache.get("foo_1")).toBeUndefined();
		vi.advanceTimersByTime(1);
		await cache.set("foo_1", "Newer");
		expect(await cache.get("foo_1")).toBe("Newer");
	});

	test('with onStoreError "throw" every call rejects with the store\'s error', async () => {
		const warn = vi.spyOn(logger, "warn").mockReturnValue();
		const { store } = storeFlaky(["delete", "get", "set"]);
		const cache = cacheCreate(store, {
			onStoreError: "throw",
			prefix: "foo",
			schema: z.string(),
		});

		await expect(cache.get("foo_1")).rejects.toThrow("Store is down");
		await expect(cache.set("foo_1", "First")).rejects.toThrow("Store is down");
		await expect(cache.delete("foo_1")).rejects.toThrow("Store is down");
		expect(warn).not.toHaveBeenCalled();
	});
});
