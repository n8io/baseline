import { describe, expect, it, vi } from "vitest";
import { cacheStoreOpen } from "./cache-store-open.ts";
import type { RedisClient } from "./redis.ts";

describe("cacheStoreOpen", () => {
	it("keeps entries in memory for memory://", async () => {
		const cacheStore = cacheStoreOpen("memory");
		await cacheStore.set("foo:1", "{}", 1_000);
		expect(await cacheStore.get("foo:1")).toBe("{}");
	});

	it("reads and writes through the Redis client otherwise", async () => {
		const get = vi.fn(async () => "{}");
		const cacheStore = cacheStoreOpen({ get } as unknown as RedisClient);
		expect(await cacheStore.get("foo:1")).toBe("{}");
		expect(get).toHaveBeenCalledExactlyOnceWith("foo:1");
	});
});
