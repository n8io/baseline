import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { cacheStoreContract } from "./cache-store.contract.ts";
import { cacheCreate, cacheStoreMemoryCreate } from "./index.ts";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const store = cacheStoreMemoryCreate();

cacheStoreContract(
	() => store,
	async (ms) => {
		vi.advanceTimersByTime(ms);
	},
);

it("a null ttlMs and onStoreError take the defaults", async () => {
	const cache = cacheCreate(cacheStoreMemoryCreate(), {
		onStoreError: null,
		prefix: "foo",
		schema: z.string(),
		ttlMs: null,
	});
	await cache.set("foo_1", "First");
	vi.advanceTimersByTime(59_999);
	expect(await cache.get("foo_1")).toBe("First");
	vi.advanceTimersByTime(1);
	expect(await cache.get("foo_1")).toBeUndefined();
});

it("entries expire after 60 s by default", async () => {
	const cache = cacheCreate(cacheStoreMemoryCreate(), {
		prefix: "foo",
		schema: z.string(),
	});
	await cache.set("foo_1", "First");
	vi.advanceTimersByTime(59_999);
	expect(await cache.get("foo_1")).toBe("First");
	vi.advanceTimersByTime(1);
	expect(await cache.get("foo_1")).toBeUndefined();
});
