import { sharedTimeLimit } from "@n8io/baseline-shared";
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

/** What `cacheStoreRedisCreate` takes. */
export type CacheStoreRedisOptions = {
	/** A connected node-redis client, such as one from `redisClientCreate` in `@n8io/baseline-redis`. */
	redisClient: CacheRedisClient;
};

/**
 * A store on a shared Redis client; entries expire with Redis PX. Each call
 * fails with a TimeoutError when Redis does not answer within 1 s. Any
 * connected node-redis client works.
 */
export const cacheStoreRedisCreate = ({
	redisClient,
}: CacheStoreRedisOptions): CacheStore => {
	const limit = <R>(work: Promise<R>): Promise<R> =>
		sharedTimeLimit({
			message: `Redis did not answer within ${cacheCommandTimeoutMs} ms`,
			ms: cacheCommandTimeoutMs,
			work,
		});

	return {
		delete: async (key) => {
			await limit(redisClient.del(key));
		},
		get: async (key) => (await limit(redisClient.get(key))) ?? undefined,
		set: async ({ json, key, ttlMs }) => {
			await limit(
				redisClient.set(key, json, {
					expiration: { type: "PX", value: ttlMs },
				}),
			);
		},
	};
};
