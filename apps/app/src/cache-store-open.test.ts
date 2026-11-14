import { describe, expect, it } from "vitest";
import { cacheStoreOpen } from "./cache-store-open.ts";

// The Redis branch is cacheStoreRedisCreate itself; the cache Package tests it on a real Redis.
describe("cacheStoreOpen", () => {
	it("keeps entries in memory for memory://", async () => {
		const cacheStore = cacheStoreOpen({ redis: "memory" });
		await cacheStore.set({ json: "{}", key: "entry:1", ttlMs: 1_000 });
		expect(await cacheStore.get("entry:1")).toBe("{}");
	});
});
