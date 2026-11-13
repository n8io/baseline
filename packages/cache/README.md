# @n8io/baseline-cache

A typed cache for one kind of value, on any store. Every read is validated by the schema you give it, so an entry an older deploy wrote reads as a miss.

```sh
pnpm add @n8io/baseline-cache
```

## Exports

- `Cache<T>`: `get(id)`, `set(id, value)` and `delete(id)`.
- `cacheCreate(store, { prefix, schema, ttlMs? })`: a cache on a store. Keys are `<prefix>:<id>` and entries expire after `ttlMs` (default 60 s). `schema` is any [Standard Schema](https://standardschema.dev): a Zod, Valibot or ArkType schema goes in as it is.
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

export const cacheStoreOpen = ({ redis }: { redis: RedisClient | "memory" }) =>
	redis === "memory"
		? cacheStoreMemoryCreate()
		: cacheStoreRedisCreate({ redisClient: redis });
```

Pass a Zod schema as `schema`. The cache's value type is the schema's output:

```ts
import { type CacheStore, cacheCreate } from "@n8io/baseline-cache";
import { z } from "zod";

declare const cacheStore: CacheStore; // from cacheStoreOpen

const Foo = z.object({ name: z.string() });

const fooCache = cacheCreate(cacheStore, {
	prefix: "foo",
	schema: Foo,
	ttlMs: 30_000,
}); // Cache<{ name: string }>

await fooCache.set("foo_01", { name: "First" });
const foo = await fooCache.get("foo_01"); // { name: "First" } or undefined
```

Entries are JSON, so a `Date` comes back as a string. Give the cache a schema that turns it back, or every read is a miss:

```ts
const FooCached = z.object({ name: z.string(), createdAt: z.coerce.date() });
```

The package does not import Zod. Any Standard Schema works the same way, for example Valibot's `v.object({ name: v.string() })`.

## Needs

- No peers. You bring the schema library (the Template uses Zod), and the Redis store takes the client you pass it, so the package needs neither `zod` nor `redis`.
- Env, by the template's convention: `CACHE_URL` (`redis://` or `rediss://`, or `memory://` for the memory store).

## Tests

`pnpm test` needs Docker: it starts a Redis container. `pnpm test:unit` runs the memory store's tests without it.
