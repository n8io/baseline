// The shared Redis global setup starts the Redis these tests use (vitest.config.ts).
/// <reference path="../../../test/redis/redis-global-setup.ts" />
import { setTimeout as sleep } from "node:timers/promises";
import {
	afterAll,
	beforeAll,
	describe,
	expect,
	inject,
	test,
	vi,
} from "vitest";
import { z } from "zod";
import { cacheContract } from "./cache.contract.ts";
import {
	cacheReconnectDelay,
	cacheRedis,
	cacheRedisClientCreate,
	type RedisClient,
} from "./cache-redis.ts";
import type { Cache } from "./index.ts";

describe("cacheRedisClientCreate", () => {
	// Load redis first so the timing tests measure the connect, not the import.
	beforeAll(async () => {
		await import("redis");
	});

	test.each(["memory://", "http://localhost:6379", "not a url"])(
		"refuses %s, listing the valid schemes",
		async (cacheUrl) => {
			await expect(cacheRedisClientCreate({ cacheUrl })).rejects.toThrow(
				new TypeError("Cache URL scheme must be one of redis://, rediss://"),
			);
		},
	);

	test("does not echo the URL, which may carry a password", async () => {
		await expect(
			cacheRedisClientCreate({ cacheUrl: "http://user:s3cret@localhost" }),
		).rejects.toThrow(expect.not.stringContaining("s3cret"));
	});

	// Timer time, not wall time: a loaded CI runner fired the real 3 s timer 542 ms late.
	test("throws within the 3 s connect timeout when Redis is unreachable", async () => {
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const settled = vi.fn();
			const created = cacheRedisClientCreate({
				cacheUrl: "redis://127.0.0.1:1",
			});
			created.then(settled, settled);
			await vi.dynamicImportSettled();
			await vi.advanceTimersByTimeAsync(2999);
			expect(settled).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			expect(settled).toHaveBeenCalled();
			await expect(created).rejects.toThrow(
				"Redis not reachable within 3000 ms",
			);
		} finally {
			vi.useRealTimers();
		}
	});

	test("backs off min(retries × 100 ms, 2 s)", () => {
		expect([0, 1, 5, 20, 21, 100].map(cacheReconnectDelay)).toEqual([
			0, 100, 500, 2000, 2000, 2000,
		]);
	});
});

describe("cacheRedis on Redis", () => {
	let redisClient: RedisClient;

	beforeAll(async () => {
		redisClient = await cacheRedisClientCreate({
			cacheUrl: inject("redisUrl"),
		});
	});

	afterAll(async () => {
		await redisClient.close();
	});

	cacheContract((options) => cacheRedis({ redisClient, ...options }), sleep);

	test("writes <prefix>:<id> with a 60 s TTL by default", async () => {
		const prefix = `test-${crypto.randomUUID()}`;
		await cacheRedis({ prefix, redisClient, schema: z.string() }).set(
			"foo_1",
			"First",
		);
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
		const pauser = await cacheRedisClientCreate({
			cacheUrl: inject("redisUrl"),
		});
		const cache = cacheRedis({
			prefix: "pause",
			redisClient,
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
