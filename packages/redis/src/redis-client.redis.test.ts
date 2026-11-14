// The shared Redis global setup starts the Redis these tests use (vitest.config.ts).
/// <reference path="../../../test/redis/redis-global-setup.ts" />
import { describe, expect, inject, it } from "vitest";
import { redisClientCreate } from "./index.ts";

describe("redisClientCreate on Redis", () => {
	it("connects before it resolves", async () => {
		await using redisClient = await redisClientCreate({
			url: inject("redisUrl"),
		});
		expect(await redisClient.ping()).toBe("PONG");
	});

	it("passes vendor settings to node-redis", async () => {
		await using redisClient = await redisClientCreate({
			url: inject("redisUrl"),
			vendor: { name: "baseline-test" },
		});
		expect(await redisClient.clientGetName()).toBe("baseline-test");
	});

	it("rejects at once when nothing listens, instead of retrying", async () => {
		const started = Date.now();
		await expect(
			redisClientCreate({ url: "redis://127.0.0.1:1" }),
		).rejects.toThrow();
		expect(Date.now() - started).toBeLessThan(3_000);
	});
});
