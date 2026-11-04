import { logger } from "@n8io/baseline-logger";
import type { createClient } from "redis";
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

// Settles like `work`, or rejects with a TimeoutError once `ms` passes first.
// node-redis's own command timeout stops once a command is sent.
export const cacheTimeLimit = async <T>(
	work: Promise<T>,
	ms: number,
	message: string,
): Promise<T> => {
	let timer: NodeJS.Timeout | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			reject(new DOMException(message, "TimeoutError"));
		}, ms);
	});
	try {
		return await Promise.race([work, timedOut]);
	} finally {
		clearTimeout(timer);
	}
};

// Connects to Redis before returning, so an unreachable Redis stops startup.
// Throws when Redis is not reachable within the connect timeout.
export const cacheRedisClientCreate = async ({
	cacheUrl,
}: {
	cacheUrl: string;
}): Promise<RedisClient> => {
	cacheUrlCheck(cacheUrl);
	// Imported here so apps that only use cacheMemoryCreate need not install redis.
	const { createClient } = await import("redis");
	const redisClient: RedisClient = createClient({
		// node-redis drops this timer once a command is sent, so it only limits
		// the wait to send (while reconnecting); cacheRedisCreate limits the reply.
		commandOptions: { timeout: cacheCommandTimeoutMs },
		socket: {
			connectTimeout: cacheConnectTimeoutMs,
			reconnectStrategy: cacheReconnectDelay,
		},
		url: cacheUrl,
	});
	// node-redis exits the process on an unlistened error event.
	redisClient.on("error", (err: unknown) => {
		logger.error({ err }, "Redis client error");
	});

	try {
		await cacheTimeLimit(
			redisClient.connect(),
			cacheConnectTimeoutMs,
			`Redis not reachable within ${cacheConnectTimeoutMs} ms`,
		);
	} catch (err) {
		redisClient.destroy();
		throw err;
	}
	return redisClient;
};

// A cache on a shared Redis client; entries expire with Redis PX. Each call
// fails with a TimeoutError when Redis does not answer within 1 s.
export const cacheRedisCreate = <T>({
	redisClient,
	...options
}: CacheOptions<T> & { redisClient: RedisClient }): Cache<T> => {
	const limit = <R>(work: Promise<R>): Promise<R> =>
		cacheTimeLimit(
			work,
			cacheCommandTimeoutMs,
			`Redis did not answer within ${cacheCommandTimeoutMs} ms`,
		);

	return cacheCreate(
		{
			delete: async (key) => {
				await limit(redisClient.del(key));
			},
			get: async (key) => (await limit(redisClient.get(key))) ?? undefined,
			set: async (key, json, ttlMs) => {
				await limit(
					redisClient.set(key, json, {
						expiration: { type: "PX", value: ttlMs },
					}),
				);
			},
		},
		options,
	);
};
