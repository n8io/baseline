import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { z } from "zod";
import { cacheContract } from "./cache.contract.ts";
import { cacheCreate, cacheStoreMemoryCreate } from "./index.ts";

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const store = cacheStoreMemoryCreate();

cacheContract(
	() => store,
	async (ms) => {
		vi.advanceTimersByTime(ms);
	},
);

test("entries expire after 60 s by default", async () => {
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
