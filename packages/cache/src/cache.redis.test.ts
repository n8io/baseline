// The shared Redis global setup starts the Redis these tests use (vitest.config.ts).
/// <reference path="../../../test/redis/redis-global-setup.ts" />
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { z } from "zod";
import { cacheContract } from "./cache.contract.ts";
import { type Cache, cacheCreate, cacheStoreRedisCreate } from "./index.ts";

describe("cacheStoreRedisCreate on Redis", () => {
	// node-redis exits the process on an unlistened error event.
	const redisClient = createClient({ url: inject("redisUrl") }).on(
		"error",
		() => undefined,
	);

	beforeAll(async () => {
		await redisClient.connect();
	});

	afterAll(async () => {
		await redisClient.close();
	});

	cacheContract(() => cacheStoreRedisCreate(redisClient), sleep);

	test("writes <prefix>:<id> with a 60 s TTL by default", async () => {
		const prefix = `test-${crypto.randomUUID()}`;
		await cacheCreate(cacheStoreRedisCreate(redisClient), {
			prefix,
			schema: z.string(),
		}).set("foo_1", "First");
		expect(await redisClient.get(`${prefix}:foo_1`)).toBe('"First"');
		const pttl = await redisClient.pTTL(`${prefix}:foo_1`);
		expect(pttl).toBeGreaterThan(59_000);
		expect(pttl).toBeLessThanOrEqual(60_000);
	});

	// A Redis that takes a command and does not answer fails each call
	// within 1 s. node-redis's own timeout stops once a command is sent.
	test.each([
		["get", (cache: Cache<string>) => cache.get("foo_1")],
		["set", (cache: Cache<string>) => cache.set("foo_1", "First")],
		["delete", (cache: Cache<string>) => cache.delete("foo_1")],
	])("%s fails within 1 s when Redis does not answer", async (_, call) => {
		const pauser = createClient({ url: inject("redisUrl") }).on(
			"error",
			() => undefined,
		);
		await pauser.connect();
		const cache = cacheCreate(cacheStoreRedisCreate(redisClient), {
			prefix: "pause",
			schema: z.string(),
		});
		await pauser.clientPause(3000);
		const started = Date.now();
		await expect(call(cache)).rejects.toThrow(
			expect.objectContaining({
				message: "Redis did not answer within 1000 ms",
				name: "TimeoutError",
			}),
		);
		const elapsed = Date.now() - started;
		expect(elapsed).toBeGreaterThanOrEqual(950);
		expect(elapsed).toBeLessThan(1500);
		await pauser.clientUnpause();
		await pauser.close();
	});
});
