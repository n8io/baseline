import { cacheRedisClientCreate } from "@n8io/baseline-cache";
import { afterAll, inject } from "vitest";
import { fooCacheContract } from "./foo-cache.contract.ts";
import { fooCacheRedisCreate } from "./foo-cache.redis.ts";

const redisClient = await cacheRedisClientCreate({
	cacheUrl: inject("integrationCacheUrl"),
});

afterAll(() => {
	redisClient.destroy();
});

fooCacheContract(async () => fooCacheRedisCreate(redisClient));
