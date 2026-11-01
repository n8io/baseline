# Cache port: client, tracing, port shape

Researched 2026-11-01. Each claim is marked [tested], [source] or [inferred]. Test code is in `docs/research/cache-port/` (needs a Redis on `localhost:56380`; Node 26.7, run `npm i && npm test` with `CLIENT=redis` or `CLIENT=ioredis`).

## Short answer

Use `redis` (node-redis) 6.x. The ioredis README itself says "For new projects, node-redis is the recommended client library" and that ioredis is in best-effort maintenance. Its OpenTelemetry package, `@opentelemetry/instrumentation-redis`, produced correct child spans in my test under Node 26 ESM. [source][tested]

The port: a small generic key-value port (`get`, `set` with TTL in ms, `delete`) that stores strings. Each domain wraps it in a typed cache (`fooCache.get(id)`) that does the JSON and the Zod parse on read. Key prefixing per domain. Leave out read-through with stampede protection until a use case needs it. [inferred, from the references in section 3]

Strongest case against: a cache is not needed at launch. None of the comparable starters ship one (section 6), and an unused port plus two adapters is code to keep. The cheaper option is to declare no cache port until the first use case needs it, and only pick the client then. If the template does ship one, the recommendation above stands.

Second case against node-redis: ioredis is still the most downloaded client (about 42M a week vs 21M) and has the longer track record. It is also still released (6.0.0 on 2026-07-31), so it is safe, but it is the older choice. [source]

## Table

| | `redis` 6.3.1 | `ioredis` 6.0.0 |
|---|---|---|
| Released | 2026-10-29 | 2026-07-31 (6.1.0-beta.1 on 2026-10-12) |
| Maintainer | Redis Inc. (`redis/node-redis`, 5 npm maintainers, 3 with redis.com addresses) | Same GitHub org (`redis/ioredis`), 2 npm maintainers; README: "best-effort" maintenance |
| Weekly downloads | 20.7M | 41.8M |
| Module format | CJS with `.d.ts` | CJS with `.d.ts` |
| Types | Bundled | Bundled, "100% written in TypeScript" |
| Cluster / Sentinel | Yes / Yes (`docs/clustering.md`, `docs/sentinel.md`) | Yes / Yes (in README) |
| Reconnect | Automatic. Default is exponential backoff, max 2000 ms plus 0 to 200 ms jitter. `reconnectStrategy` can stop it. | Automatic. `retryStrategy`, plus `maxRetriesPerRequest`. |
| Graceful close | `client.close()` waits for pending replies. `client.destroy()` closes now. | `redis.quit()` sends QUIT and waits. `redis.disconnect()` closes now. |
| Deprecated | `quit()`, `disconnect()` (use `close()`, `destroy()`) | Not marked deprecated in the types I read (`Redis.d.ts` has one unrelated `@deprecated`). |
| Node | >= 20 | >= 20 |
| OTel instrumentation | `@opentelemetry/instrumentation-redis` 0.72.0 | `@opentelemetry/instrumentation-ioredis` 0.72.0 |
| Built-in telemetry | OTel metrics (`OpenTelemetry.init`) and `diagnostics_channel` | `diagnostics_channel` |

Sources: npm registry metadata and download API (queried 2026-11-01); the two READMEs and docs linked below.

## Details

### 1. Client

- Versions and dates come from `npm view`. `redis` 6.3.1 was published 2026-10-29 and `redis/node-redis` was pushed to on 2026-10-31. `ioredis` 6.0.0 was published 2026-07-31 and the repo was last pushed 2026-10-30. Neither repo is archived. [source: https://www.npmjs.com/package/redis, https://www.npmjs.com/package/ioredis, https://github.com/redis/ioredis, https://github.com/redis/node-redis]
- What Redis says about ioredis: README line 17, "ioredis is a stable project and maintenance is done on a best-effort basis ... For new projects, node-redis is the recommended client library." [source: https://github.com/redis/ioredis#readme]
- Closing, node-redis: "`client.QUIT/quit()` is replaced by `client.close()`. and ... `client.disconnect()` has been renamed to `client.destroy()`." The `.d.ts` marks `QUIT` and `disconnect` as `@deprecated`. In my test, `await client.close()` let the process exit cleanly. [source: https://github.com/redis/node-redis#disconnecting][tested]
- Closing, ioredis: `quit()` is the graceful call, `disconnect()` closes now. The README says `disconnect()` or `quit()` stop reconnecting. In my test `await redis.quit()` exited cleanly. [source: https://github.com/redis/ioredis#readme][tested]
- The template's shutdown step therefore is `await client.close()` for node-redis, with `client.destroy()` as the fallback after a timeout. `redis.quit()` in the brief is the ioredis form.
- `redis` the package is a bundle: `@redis/client` plus json, bloom, search, time-series. `@redis/client` alone is enough for a cache and lists no dependencies on npm. Whether the OTel package patches `@redis/client` when installed alone was not tested. [source: npm metadata]
- v6 of both made breaking changes: node-redis 6 and ioredis 6 default to RESP3 (ioredis: `protocol: 2` keeps the old wire format), and both need Node >= 20. Plain `get`/`set` are not affected. [source: https://github.com/redis/node-redis/blob/master/docs/v5-to-v6.md, https://github.com/redis/ioredis/releases/tag/v6.0.0]
- node-redis 6 has a `keyPrefix` client option ("ioredis-compatible"), so prefixing can be done in the client or in the adapter. [source: https://github.com/redis/node-redis/blob/master/docs/client-configuration.md]
- node-redis supports Redis 7.2 to 8.2 officially; `redis:8-alpine` is inside that range. [source: https://github.com/redis/node-redis/blob/master/SUPPORTED_REDIS_VERSIONS.md]
- Valkey: neither README or docs nor the installed packages mention Valkey (I searched the installed packages and the READMEs). Both clients speak the Redis protocol, so they likely work, but neither project claims official support. [source: absence][inferred]
  - `iovalkey` 0.4.0 (2026-07-27) is a fork of ioredis, in the `valkey-io` GitHub org, one npm maintainer (Matteo Collina), 0.9M downloads a week. [source: https://github.com/valkey-io/iovalkey]
  - `@valkey/valkey-glide` 2.5.3 (2026-09-24) is the official Valkey client, Rust core with a Node binding, 0.7M a week. I did not look for an OTel instrumentation for it. [source: https://github.com/valkey-io/valkey-glide]
  - Worth noting only. Not a reason to choose either now.

### 2. OpenTelemetry

Test setup: Node 26.7, `NodeSDK` 0.300.0 with an explicit instrumentation, a throwaway `redis:8-alpine` container on port 56380 (56379 was taken by another project's container, which I left alone; mine is stopped), a parent span, then `set` (with TTL), `get`, `del`. [tested]

| Case | Result |
|---|---|
| `redis` 6.3.1 + `instrumentation-redis` 0.72.0, with import hook | `redis-connect`, `SET`, `GET`, `DEL` spans. `SET`, `GET` and `DEL` are children of the parent span. |
| Same, no import hook | Same four spans, same parents. |
| `ioredis` 6.0.0 + `instrumentation-ioredis` 0.72.0, with import hook | `set`, `get`, `del` spans, all children of the parent. |
| Same, no import hook | 0 spans. |

- Meaning: node-redis is traced in ESM with or without the hook. ioredis needs the hook. Probably because the node-redis instrumentation patches files inside `@redis/client` while the ioredis one patches the top-level export, which ESM `import` of a CJS module does not see. That explanation is [inferred]; the result is [tested].
- Package choice: `instrumentation-redis` handles `redis` 2.x to 5.x/6.x in one package (the former `-redis-4` package is separate and stale, 0.49.0). Its README is inconsistent: one line says "versions `>=2.6.0 <6`", another "`>=2.6.0 <7`". My test shows it works with 6.3.1, so the second is right in practice. [source: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-redis][tested]
- Both instrumentation packages need `@opentelemetry/instrumentation` ^0.300.0 and `@opentelemetry/api` ^1.3.0 as a peer. `@opentelemetry/api` 1.10.0 and `sdk-trace-base` 2.12.0 cannot be installed together without `--force` (its peer range stops at `<1.10.0`), so pin versions together. [tested]
- Surprise: on Node 26, `module.register()`, which the OTel ESM hook uses (`register('@opentelemetry/instrumentation/hook.mjs', ...)`), prints `DEP0205`: use `module.registerHooks()` instead. Not verified whether OTel has a replacement. [tested]
- Spans from `instrumentation-redis` 0.68+ follow the stable semantic conventions (`db.system.name`, `db.operation.name`). [source: its README]
- Both clients also publish `diagnostics_channel` events (no OTel dependency). [source: READMEs]

### 3. What a cache port looks like

Real examples I read:

- Hexagonal TS repos with a `CachePort`: `sixtusDev/typescript-nestjs-clean-architecture` (`get<T>(key)`, `set<T>(key, value, ttl?)`, `delete(key)`), `mahmoudsoliman/trip-search-service` (same, TTL in seconds, required). `wildan3105/GitLingo` is the typed kind: a `CachePort` keyed by `CacheKey` for one entity, with staleness checked by the caller. [source: https://github.com/sixtusDev/typescript-nestjs-clean-architecture, https://github.com/mahmoudsoliman/trip-search-service, https://github.com/wildan3105/GitLingo]
- Libraries:
  - Keyv 6.1.0: `get`, `set(key, value, ttl)`, `delete`, `clear`; `namespace` option; built-in JSON serializer; TTL in ms. [source: https://github.com/jaredwray/keyv]
  - cache-manager 7.2.9 (now in `jaredwray/cacheable`, built on Keyv): `get`, `set`, `del`, `wrap(key, fn)`, `refreshThreshold`, and `promise-coalesce` is embedded for concurrent `wrap` calls. [source: https://github.com/jaredwray/cacheable/tree/main/packages/cache-manager]
  - Nest: `@nestjs/cache-manager`; `get`, `set(key, value, ttlMs)`, `del`; in memory by default. [source: https://docs.nestjs.com/techniques/caching]
  - BentoCache 1.6.1: namespaces, stampede protection, grace period, tags, multi-tier, OTel package. A "full-featured caching solution", by its own README. [source: https://github.com/Julien-R44/bentocache]
  - `@epic-web/cachified` 5.6.3 (Epic Stack): cache interface of `get`, `set`, `delete`; adds stale-while-revalidate, de-duplication and a value validator (Standard Schema, so Zod works) on top. [source: https://github.com/epicweb-dev/cachified]

| Feature | Common practice? |
|---|---|
| `get`, `set` with TTL, `delete` | Yes, in every example. |
| TTL unit | Not agreed: ms in Keyv, cache-manager and Nest; seconds in the trip-search example. Pick ms and name the argument `ttlMs`. |
| Key prefix / namespace | Common in libraries (Keyv, BentoCache); in the hexagonal examples keys are built by the caller. |
| JSON serialization | Libraries do it. Hexagonal examples store `T` and let the adapter serialize. |
| Zod parse on read | Not common. Only cachified offers value validation. Worth doing for a shared Redis, where old entries written by an older version of the app can have an old shape. [inferred] |
| Read-through / `getOrSet` / `wrap` | Common in libraries. Absent from the plain `CachePort` examples. |
| Stampede protection | Only in the libraries (cache-manager, BentoCache, cachified). Extra. |

Generic or typed: the plain hexagonal examples are generic (`CachePort` with string keys), and the typed per-entity form exists (GitLingo) but is the rarer one. This repo's glossary says a Port is declared by a domain "for something it needs", which fits the typed form. Both fit if the domain port is typed and the Redis adapter is a thin layer over a generic key-value helper. [inferred]

Samples, with `foo`:

```ts
// Option A: typed port, declared in the foo domain (matches the glossary)
export type FooCache = {
  get(id: string): Promise<Foo | null>;
  set(foo: Foo, ttlMs?: number): Promise<void>;
  delete(id: string): Promise<void>;
};

// SPI adapter, takes the shared client. Zod parse on read; a bad entry counts as a miss.
export const fooCacheRedis = (redis: RedisClient): FooCache => {
  const key = (id: string) => `foo:${id}`;
  return {
    async get(id) {
      const raw = await redis.get(key(id));
      if (raw === null) return null;
      const parsed = fooSchema.safeParse(JSON.parse(raw));
      return parsed.success ? parsed.data : null;
    },
    async set(foo, ttlMs) {
      await redis.set(key(foo.id), JSON.stringify(foo), ttlMs ? { PX: ttlMs } : undefined);
    },
    async delete(id) {
      await redis.del(key(id));
    },
  };
};
```

```ts
// Option B: generic string port (shared package), each domain adds its own typed layer
export type Cache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
};
```

Read-through, if ever needed, goes in the use case (or a helper), not in the port: `get`, on miss load, then `set`. Stampede protection is a per-process map of in-flight promises keyed by cache key (what `promise-coalesce` does); it protects one process, not the fleet. [inferred]

### 4. In-memory adapter and TTL

- Use lazy expiry based on `Date.now()`: store `expiresAt = Date.now() + ttlMs`, and on `get` treat an entry as a miss if `expiresAt <= Date.now()`. Vitest's `vi.useFakeTimers()` fakes `Date` by default, so `vi.advanceTimersByTime(1000)` and `vi.setSystemTime()` both move it. [tested: `memory-cache.test.ts`, 4 tests pass with Vitest 5.0.5]
- A `setTimeout` per entry also works under fake timers, but needs `.unref()` so it does not hold the process open, and it creates one timer per entry. A sweeper with `setInterval` has the same issue. Lazy expiry needs neither. Entries that are never read again stay in the map until evicted, so combine it with a size limit. [tested][inferred]
- Size limit: a `Map` keeps insertion order, so delete-and-reinsert on read gives LRU, and `map.keys().next().value` is the oldest. About 15 lines, no dependency (the adapter in `memory-cache.ts` does this). The alternative is `lru-cache`, which the Epic Stack uses. Few-dependencies rule says write the 15 lines. [tested][source: https://github.com/epicweb-dev/epic-stack/blob/main/app/utils/cache.server.ts]
- An optional `now` parameter on the factory is another way to test without fake timers. Not needed with Vitest.

### 5. URL schemes

- `new URL("memory://")` parses in Node 26 without error: `protocol: "memory:"`, empty host and path. `memory:` and `memory://local` also parse. Real schemes parse too: `redis:`, `rediss:`, `postgres:`, `postgresql:`. [tested]
- `pg` accepts both `postgres://` and `postgresql://`: `pg-connection-string` 2.14.1 parses both to the same result, and the parser builds a `URL` against a `postgres://` base, so I saw no scheme check in it. PostgreSQL's own documentation lists both as valid URI prefixes. [tested][source: https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS]
- Redis: node-redis's documented format is `redis[s]://[[username][:password]@][host][:port][/db-number]`, so `rediss://` is TLS. [source: https://github.com/redis/node-redis#basic-example]
- Precedent for `memory://`: I did not find one in Keyv or cache-manager. Keyv takes a store object (`new Keyv(new KeyvRedis('redis://...'))`) and uses an in-process Map when given none; its scheme examples are `redis://` and `sqlite://`. cache-manager takes a stores array and defaults to memory. So `memory://` would be this template's own convention. [source: Keyv and cache-manager READMEs][inferred]
- Suggestion: switch on `new URL(value).protocol` against a fixed list: `postgres:` and `postgresql:` both map to pg, `redis:` and `rediss:` both map to Redis, `memory:` to in-memory, and anything else fails at startup with a message. [inferred]

### 6. Is a cache needed at launch

What comparable starters ship, checked by searching each repo for Redis or cache code (2026-11-01):

- create-t3-app: no cache. Redis appears only as a recommendation (Upstash) in "other recs". https://github.com/t3-oss/create-t3-app
- Epic Stack: has caching built in (SQLite cache plus in-memory LRU, `cachified`), with no Redis. A test stub replaces it with an in-memory one (decision 047). Their rate-limit decision note names Redis as the common solution and says memory is the default. https://github.com/epicweb-dev/epic-stack/blob/main/docs/caching.md
- RedwoodJS: `redwoodjs/redwood` has no cache package; the code search found nothing. https://github.com/redwoodjs/redwood
- Wasp: the search found only a blog post and an example app that mention Redis, not the template. https://github.com/wasp-lang/wasp
- NestJS: `nestjs/typescript-starter` has no cache or Redis. Caching is an opt-in module in the docs (`@nestjs/cache-manager`). https://github.com/nestjs/typescript-starter

So 0 of 5 ship a cache port, 1 ships an app-level cache (Epic Stack, SQLite plus LRU). [source]

## Not verified

- Whether `instrumentation-redis` also works when only `@redis/client` is installed (without the `redis` bundle).
- A replacement for the deprecated `module.register()` in the OTel hook on Node 26.
- Behaviour of either client against a real failover (Sentinel, Cluster) or a network drop; reconnect claims come from docs only.
- Official Valkey support: neither project's docs mention it. I did not test either against Valkey. No OTel instrumentation was checked for `valkey-glide` or `iovalkey`.
- A hexagonal "reference repo" survey beyond the three `CachePort` examples; this is a small sample, not a ranking.
- Weekly downloads include CI and transitive installs (for example `ioredis` is used by BullMQ and others), so they overstate direct use.
- Wasp and Redwood: I searched the repos but did not read their generated templates in full.
