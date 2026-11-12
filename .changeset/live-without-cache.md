---
"@n8io/baseline-live": major
"@n8io/baseline-cache": major
---

live no longer depends on `@n8io/baseline-cache`, so a project can install live without cache. `liveHubRedisCreate` takes any connected node-redis client, including the one `cacheRedisClientCreate` returns, and owns its own timeout. cache no longer exports `cacheTimeLimit`; copy the few lines into your code if you used it.
