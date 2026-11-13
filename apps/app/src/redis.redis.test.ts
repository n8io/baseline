import { describe, expect, inject, it } from "vitest";
import { redisClientCreate } from "./redis.ts";

describe("redisClientCreate", () => {
	it("connects before it resolves", async () => {
		const redisClient = await redisClientCreate({
			url: inject("integrationCacheUrl"),
		});
		try {
			expect(await redisClient.ping()).toBe("PONG");
		} finally {
			redisClient.destroy();
		}
	});

	it("rejects at once when nothing listens, instead of retrying", async () => {
		const started = Date.now();
		await expect(
			redisClientCreate({ url: "redis://127.0.0.1:1" }),
		).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(3_000);
	});
});
