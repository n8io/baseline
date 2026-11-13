import { describe, expect, it, vi } from "vitest";
import { cacheStoreOpen } from "./cache-store-open.ts";
import type { RedisClient } from "./redis.ts";

describe("cacheStoreOpen", () => {
	it("keeps entries in memory for memory://", async () => {
		const cacheStore = cacheStoreOpen({ redis: "memory" });
		await cacheStore.set("entry:1", "{}", 1_000);
		expect(await cacheStore.get("entry:1")).toBe("{}");
	});

	it("reads and writes through the Redis client otherwise", async () => {
		const get = vi.fn(async () => "{}");
		const cacheStore = cacheStoreOpen({
			redis: { get } as unknown as RedisClient,
		});
		expect(await cacheStore.get("entry:1")).toBe("{}");
		expect(get).toHaveBeenCalledExactlyOnceWith("entry:1");
	});
});
