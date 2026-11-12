---
"app": minor
---

A Project can now remove the cache, and then Redis, with the steps in `docs/agents/pieces.md`. The cache and live updates are separate pieces: removing the cache keeps live updates on Redis, and Redis goes only once both are gone. The composition roots open Redis with the new `src/redis.ts` (`redisClientCreate`) instead of `cacheRedisClientCreate`, so live updates no longer need `@n8io/baseline-cache`; their shutdown step is now named `redis`. Integration tests no longer pass `cacheUrl` to `productionServerStart` or `workerStart`: `production-server.ts` reads it from the global setup itself.
