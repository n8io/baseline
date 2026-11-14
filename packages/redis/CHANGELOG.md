# @n8io/baseline-redis

## 1.0.0

### Major Changes

- 92e9814: Add `@n8io/baseline-redis`: `redisClientCreate({ url, vendor? })` opens the one Redis connection the cache and live updates share, with the startup and reconnect behaviour the Template used to hand-roll (fail at startup within 3 s, then reconnect for good; the `error` event always listened to). The Template's `src/redis.ts` becomes `src/redis-open.ts`, which only turns `CACHE_URL` into a client and its shutdown step, and the app no longer depends on `redis` directly.

  To upgrade: when `pnpm template-upgrade` conflicts on `src/redis.ts`, delete it and `src/redis.redis.test.ts`, and move any setting you changed there to `vendor` in `src/redis-open.ts`. Take `architecture-test-rules.ts` from the Template as it is.
