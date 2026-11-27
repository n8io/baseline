---
"@n8io/baseline-logger": minor
---

Adds `createLogger({ level })`, which builds a logger from an explicit config object and reads no environment. `loggerCreate` is unchanged for current callers: it still takes `LOG_LEVEL` when called, not at import.
