# @n8io/baseline-cache

A typed cache for one kind of value, on Redis or in memory. Every read is parsed with Zod, so an entry an older deploy wrote reads as a miss.

```sh
pnpm add @n8io/baseline-cache
```

## Exports

- `Cache<T>`: `get(id)`, `set(id, value)` and `delete(id)`.
- `cacheRedisClientCreate({ cacheUrl })`: connects one shared Redis client, and throws if Redis is not reachable at startup.
- `cacheRedisCreate({ redisClient, prefix, schema, ttlMs? })`: a cache on that client. Keys are `<prefix>:<id>`, entries expire after `ttlMs` (default 60 s), and each call fails after 1 s without an answer.
- `cacheMemoryCreate({ prefix, schema, ttlMs? })`: the same cache in process, for unit tests and `memory://`.
- `cacheTimeLimit(work, ms, message)`: rejects with a `TimeoutError` when `work` takes longer than `ms`.
- `RedisClient`: the client type.

## Example

```ts
import { cacheRedisClientCreate, cacheRedisCreate } from "@n8io/baseline-cache";
import { z } from "zod";

const redisClient = await cacheRedisClientCreate({ cacheUrl: ENV.CACHE_URL });
const fooCache = cacheRedisCreate({
	prefix: "foo",
	redisClient,
	schema: z.object({ name: z.string() }),
	ttlMs: 30_000,
});

await fooCache.set("foo_01", { name: "First" });
const foo = await fooCache.get("foo_01"); // { name: "First" } or undefined
```

## Needs

- Peers: `zod`, and `redis` unless you only use `cacheMemoryCreate`.
- Env, by the template's convention: `CACHE_URL` (`redis://` or `rediss://`). For `memory://` the template's composition roots use the memory adapters instead.

## Tests

`pnpm test` needs Docker: it starts a Redis container.
