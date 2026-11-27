---
"@n8io/baseline-postgres": patch
---

The package's logger is now built on its first use, not when the module loads, so a bad `LOG_LEVEL` no longer throws at import. The same `TypeError` is thrown by the first call that needs the logger.
