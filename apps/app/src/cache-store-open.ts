// The cache store for a composition root: on Redis, or in memory for memory://. The only file that
// names the cache's backend. `pnpm piece-remove cache` deletes this file.
import {
	type CacheStore,
	cacheStoreMemoryCreate,
	cacheStoreRedisCreate,
} from "@n8io/baseline-cache";
import type { RedisClient } from "./redis.ts";

export const cacheStoreOpen = (redis: RedisClient | "memory"): CacheStore =>
	redis === "memory" ? cacheStoreMemoryCreate() : cacheStoreRedisCreate(redis);
