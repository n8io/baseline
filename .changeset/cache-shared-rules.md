---
"@n8io/baseline-cache": minor
---

Follow the shared Package rules: `CacheOptions.ttlMs` and `onStoreError` also take `null` (the default, as leaving them out does), the new `CacheStoreRedisOptions` names what `cacheStoreRedisCreate` takes, and every export carries a JSDoc comment that ships in the types. The README's Exports fold is now a table.
