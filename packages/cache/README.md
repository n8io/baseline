# @n8io/baseline-cache

A typed cache for one kind of value, on any store. Every read is parsed with Zod, so an entry an older deploy wrote reads as a miss.

```sh
pnpm add @n8io/baseline-cache
```

## Exports

- `Cache<T>`: `get(id)`, `set(id, value)` and `delete(id)`.
- `cacheCreate(store, { prefix, schema, ttlMs? })`: a cache on a store. Keys are `<prefix>:<id>` and entries expire after `ttlMs` (default 60 s).
- `CacheStore`: where entries live, as JSON strings by key with a TTL. Open one per process and build every cache on it; a new backend is one more `CacheStore`.
- `cacheStoreRedisCreate({ redisClient })`: a store on a connected node-redis client. Each call fails after 1 s without an answer.
- `cacheStoreMemoryCreate()`: a store in process, for unit tests and `memory://`. Caches on one store share its keys, as on Redis, so give each its own `prefix`.

## Example

Pick the store in one place, and name no backend anywhere else:

```ts
// src/cache-store-open.ts: the only file that knows the backend
import {
	cacheStoreMemoryCreate,
	cacheStoreRedisCreate,
} from "@n8io/baseline-cache";

export const cacheStoreOpen = (redis: RedisClient | "memory") =>
	redis === "memory"
		? cacheStoreMemoryCreate()
		: cacheStoreRedisCreate({ redisClient: redis });
```

```ts
import { type CacheStore, cacheCreate } from "@n8io/baseline-cache";
import { z } from "zod";

declare const cacheStore: CacheStore; // from cacheStoreOpen

const fooCache = cacheCreate(cacheStore, {
	prefix: "foo",
	schema: z.object({ name: z.string() }),
	ttlMs: 30_000,
});

await fooCache.set("foo_01", { name: "First" });
const foo = await fooCache.get("foo_01"); // { name: "First" } or undefined
```

## Needs

- Peers: `zod`. The Redis store takes the client you pass it, so the package itself does not need `redis`.
- Env, by the template's convention: `CACHE_URL` (`redis://` or `rediss://`, or `memory://` for the memory store).

## Tests

`pnpm test` needs Docker: it starts a Redis container. `pnpm test:unit` runs the memory store's tests without it.
