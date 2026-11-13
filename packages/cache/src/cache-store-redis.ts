import type { CacheStore } from "./cache.ts";

// The part of a connected node-redis client the store uses.
type CacheRedisClient = {
	del(key: string): Promise<unknown>;
	get(key: string): Promise<string | null>;
	set(
		key: string,
		value: string,
		options: { expiration: { type: "PX"; value: number } },
	): Promise<unknown>;
};

const cacheCommandTimeoutMs = 1000;

// Settles like `work`, or rejects with a TimeoutError once `ms` passes first.
// node-redis's own command timeout stops once a command is sent.
const cacheTimeLimit = async <T>(
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

// A store on a shared Redis client; entries expire with Redis PX. Each call
// fails with a TimeoutError when Redis does not answer within 1 s. Any
// connected node-redis client works.
export const cacheStoreRedisCreate = (
	redisClient: CacheRedisClient,
): CacheStore => {
	const limit = <R>(work: Promise<R>): Promise<R> =>
		cacheTimeLimit(
			work,
			cacheCommandTimeoutMs,
			`Redis did not answer within ${cacheCommandTimeoutMs} ms`,
		);

	return {
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
	};
};
