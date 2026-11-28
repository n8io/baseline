---
"@n8io/baseline-logger": patch
---

Adds `loggerDefaultCreate()`, which returns a getter for one logger built by `loggerCreate` on its first call, not at import, and the same logger after. A Package makes one at module level so a bad `LOG_LEVEL` throws at first use, never at import.
