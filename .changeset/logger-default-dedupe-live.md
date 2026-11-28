---
"@n8io/baseline-live": patch
---

The package's default logger now comes from `@n8io/baseline-logger`'s `loggerDefaultCreate`. Behaviour is unchanged: the logger is built on its first use, and a bad `LOG_LEVEL` throws the same `TypeError` there.
