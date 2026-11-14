---
"@n8io/baseline-redis": major
"app": minor
---

Add `@n8io/baseline-redis`: `redisClientCreate({ url, vendor? })` opens the one Redis connection the cache and live updates share, with the startup and reconnect behaviour the Template used to hand-roll (fail at startup within 3 s, then reconnect for good; the `error` event always listened to). The Template's `src/redis.ts` becomes `src/redis-open.ts`, which only turns `CACHE_URL` into a client and its shutdown step, and the app no longer depends on `redis` directly. A Project that changed its `src/redis.ts` moves those settings to `redisClientCreate`'s `vendor` option in `src/redis-open.ts`.
