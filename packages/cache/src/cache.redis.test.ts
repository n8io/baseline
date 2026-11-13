// The shared Redis global setup starts the Redis these tests use (vitest.config.ts).
/// <reference path="../../../test/redis/redis-global-setup.ts" />
import { setTimeout as sleep } from "node:timers/promises";
import { createClient } from "redis";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	inject,
	onTestFinished,
	test,
} from "vitest";
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

	cacheContract(() => cacheStoreRedisCreate({ redisClient }), sleep);

	// Stops Redis answering for 3 s, or until the test ends.
	const redisPause = async (): Promise<void> => {
		const pauser = createClient({ url: inject("redisUrl") }).on(
			"error",
			() => undefined,
		);
		await pauser.connect();
		onTestFinished(async () => {
			await pauser.clientUnpause();
			await pauser.close();
		});
		await pauser.clientPause(3000);
	};

	test("writes <prefix>:<id> with a 60 s TTL by default", async () => {
		const prefix = `test-${crypto.randomUUID()}`;
		await cacheCreate(cacheStoreRedisCreate({ redisClient }), {
			prefix,
			schema: z.string(),
		}).set("foo_1", "First");
		expect(await redisClient.get(`${prefix}:foo_1`)).toBe('"First"');
		const pttl = await redisClient.pTTL(`${prefix}:foo_1`);
		expect(pttl).toBeGreaterThan(59_000);
		expect(pttl).toBeLessThanOrEqual(60_000);
	});

	// A Redis that takes a command and does not answer: each call gives up
	// within 1 s (node-redis's own timeout stops once a command is sent) and
	// the cache carries on without it.
	test.each([
		["get", (cache: Cache<string>) => cache.get("foo_1")],
		["set", (cache: Cache<string>) => cache.set("foo_1", "First")],
		["delete", (cache: Cache<string>) => cache.delete("foo_1")],
	])("%s resolves within 1 s when Redis does not answer", async (_, call) => {
		const cache = cacheCreate(cacheStoreRedisCreate({ redisClient }), {
			prefix: "pause",
			schema: z.string(),
		});
		await redisPause();
		const started = Date.now();
		expect(await call(cache)).toBeUndefined();
		const elapsed = Date.now() - started;
		expect(elapsed).toBeGreaterThanOrEqual(950);
		expect(elapsed).toBeLessThan(1500);
	});

	test('with onStoreError "throw" a call fails within 1 s when Redis does not answer', async () => {
		const cache = cacheCreate(cacheStoreRedisCreate({ redisClient }), {
			onStoreError: "throw",
			prefix: "pause",
			schema: z.string(),
		});
		await redisPause();
		const started = Date.now();
		await expect(cache.get("foo_1")).rejects.toThrow(
			expect.objectContaining({
				message: "Redis did not answer within 1000 ms",
				name: "TimeoutError",
			}),
		);
		expect(Date.now() - started).toBeLessThan(1500);
	});

	test("a Redis that is gone is a miss on get, and set and delete resolve", async () => {
		const gone = createClient({ url: inject("redisUrl") }).on(
			"error",
			() => undefined,
		);
		await gone.connect();
		gone.destroy();
		const cache = cacheCreate(cacheStoreRedisCreate({ redisClient: gone }), {
			prefix: "gone",
			schema: z.string(),
		});

		expect(await cache.get("foo_1")).toBeUndefined();
		expect(await cache.set("foo_1", "First")).toBeUndefined();
		expect(await cache.delete("foo_1")).toBeUndefined();
	});
});
