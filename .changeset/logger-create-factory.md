---
"@n8io/baseline-logger": major
---

Replaces the module-level `logger` export with `loggerCreate({ level })`, which returns a logger and validates the level (default `LOG_LEVEL`, then `info`) when called. A bad `LOG_LEVEL` now fails at startup, where the caller calls `loggerCreate`, with a `TypeError` naming the valid levels; importing the Package never throws. The old `logger` export is removed, so this is breaking: replace `import { logger }` with a `loggerCreate()` call.
