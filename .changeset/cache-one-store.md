---
"@n8io/baseline-cache": major
"app": major
---

The cache's backend is picked once per process, not once per Domain. `@n8io/baseline-cache` now exports `CacheStore`, `cacheCreate(store, { prefix, schema, ttlMs? })`, `cacheStoreRedisCreate(redisClient)` and `cacheStoreMemoryCreate()`. `cacheRedisCreate`, `cacheMemoryCreate`, `cacheRedisClientCreate` and the `RedisClient` type are gone, and the package no longer has a `redis` peer: the Redis store takes any connected node-redis client.

In the Template, the new `src/cache-store-open.ts` is the only file that names the backend, and `connectionsOpen` returns its store as `connections.cacheStore`. Each Domain has one `spi/<domain>-cache.ts` (`<domain>CacheCreate(cacheStore)`) with one `spi/<domain>-cache.test.ts`.

When you upgrade, in each Domain: replace `spi/<domain>-cache.redis.ts` and `spi/<domain>-cache.memory.ts` with a `spi/<domain>-cache.ts` copied from Foo, replace their two tests and `spi/<domain>-cache.contract.ts` with Foo's `spi/foo-cache.test.ts`, pass `connections.cacheStore` in `spi/index.ts`, and pass `cacheStoreMemoryCreate()` in `spi/<domain>-ports.memory.ts`. If you used `cacheRedisClientCreate`, use `redisClientCreate` from `src/redis.ts`.
