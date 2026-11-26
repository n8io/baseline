---
"@n8io/baseline-logger": minor
---

Adds `loggerCreate({ level })`, which returns a logger and validates the level (default `LOG_LEVEL`, then `info`) when called, throwing a `TypeError` that names the valid levels for a bad one. The default `logger` export remains, so no caller changes, but importing it no longer throws on a bad `LOG_LEVEL`: it falls back to `info`.
