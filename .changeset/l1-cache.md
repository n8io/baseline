---
"@n8io/baseline-cache": minor
---

`cacheCreate` checks its options when called: `cacheCreate: ttlMs must be a positive integer`, `cacheCreate: prefix must not be empty`, `cacheCreate: onStoreError must be "miss" or "throw"` (a bad `ttlMs` used to fail every Redis write and show as a store outage). The memory store's doc no longer suggests fake timers.
