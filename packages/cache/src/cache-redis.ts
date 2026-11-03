import { logger } from "@n8io/baseline-logger";
import type { createClient, RedisClientOptions } from "redis";
import { type Cache, type CacheOptions, cacheCreate } from "./cache.ts";

export type RedisClient = ReturnType<typeof createClient>;

const cacheUrlSchemes = ["redis:", "rediss:"];
const cacheConnectTimeoutMs = 3000;
const cacheCommandTimeoutMs = 1000;

// Reconnect backoff: min(retries × 100 ms, 2 s).
export const cacheReconnectDelay = (retries: number): number =>
	Math.min(retries * 100, 2000);

const cacheUrlCheck = (cacheUrl: string): void => {
	const scheme = URL.parse(cacheUrl)?.protocol;
	if (scheme === undefined || !cacheUrlSchemes.includes(scheme)) {
		// Never echo the URL: it may carry a password.
		throw new TypeError("Cache URL scheme must be one of redis://, rediss://");
	}
};

// Connects to Redis before returning, so an unreachable Redis stops startup.
// Throws when Redis is not reachable within the connect timeout.
export const cacheRedisClientCreate = async ({
	cacheUrl,
	...options
}: {
	cacheUrl: string;
} & Partial<RedisClientOptions>): Promise<RedisClient> => {
	cacheUrlCheck(cacheUrl);
	// Imported here so apps that only use cacheMemory need not install redis.
	const { createClient } = await import("redis");
	const redisClient: RedisClient = createClient({
		...options,
		commandOptions: {
			timeout: cacheCommandTimeoutMs,
			...options.commandOptions,
		},
		socket: {
			connectTimeout: cacheConnectTimeoutMs,
			reconnectStrategy: cacheReconnectDelay,
			...options.socket,
		},
		url: cacheUrl,
	});
	// node-redis exits the process on an unlistened error event.
	redisClient.on("error", (err: unknown) => {
		logger.error({ err }, "Redis client error");
	});

	let timer: NodeJS.Timeout | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(
				new Error(`Redis not reachable within ${cacheConnectTimeoutMs} ms`),
			);
		}, cacheConnectTimeoutMs);
	});
	try {
		await Promise.race([redisClient.connect(), timedOut]);
	} catch (err) {
		redisClient.destroy();
		throw err;
	} finally {
		clearTimeout(timer);
	}
	return redisClient;
};

// A cache on a shared Redis client; entries expire with Redis PX.
export const cacheRedis = <T>({
	redisClient,
	...options
}: CacheOptions<T> & { redisClient: RedisClient }): Cache<T> =>
	cacheCreate(
		{
			delete: async (key) => {
				await redisClient.del(key);
			},
			get: async (key) => (await redisClient.get(key)) ?? undefined,
			set: async (key, json, ttlMs) => {
				await redisClient.set(key, json, {
					expiration: { type: "PX", value: ttlMs },
				});
			},
		},
		options,
	);
