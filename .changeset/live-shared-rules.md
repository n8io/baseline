---
"@n8io/baseline-live": minor
---

Follow the shared Package rules: `LiveUpdate`, `LiveHubRedisOptions` and `LiveStreamOptions` are exported, `liveStreamCreate`'s `signal` and `useLiveUpdates`' `pathPrefix` also take `null` (the default, as leaving them out does), and every export carries a JSDoc comment that ships in the types. The README's Exports fold is now a table, with a "Picking the hub in one place" part.
