import { cacheRedisCreate, type RedisClient } from "@n8io/baseline-cache";
import type { FooCache } from "../ports.ts";
import { fooCached } from "./foo-cached.ts";

// fooCached, not Foo: JSON turns dates into strings.
export const fooCacheRedis = (redisClient: RedisClient): FooCache => {
	const cache = cacheRedisCreate({
		prefix: "foo",
		redisClient,
		schema: fooCached,
	});
	return {
		delete: cache.delete,
		get: cache.get,
		set: (foo) => cache.set(foo.id, foo),
	};
};
