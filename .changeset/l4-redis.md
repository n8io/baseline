---
"@n8io/baseline-redis": patch
---

redisClientCreate prints a refused scheme with `://` (`found "http://"`), as postgres does. README: the `redisClientCreate` row says what it rejects.
