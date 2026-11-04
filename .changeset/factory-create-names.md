---
"@n8io/baseline-cache": major
"@n8io/baseline-queue": major
"@n8io/baseline-pulsar": major
"app": patch
---

Factories that build and return a thing now end in `Create`: `cacheMemory` is `cacheMemoryCreate`, `cacheRedis` is `cacheRedisCreate`, `queueEventsMemory` is `queueEventsMemoryCreate`, `queueEventsPgBoss` is `queueEventsPgBossCreate` and `pulsarEvents` is `pulsarEventsCreate`. There are no deprecated aliases; rename the imports.
