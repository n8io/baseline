---
"@n8io/baseline-cache": minor
"@n8io/baseline-live": minor
"app": patch
---

Keep serving through a Redis outage.

- cache: `cacheCreate` fails open. A store error or timeout is a miss on `get` and resolves on `set` and `delete`; it is counted on `baseline.cache.store_errors` and logged once per 30 s. After a failed `set` or `delete` the same process reads that id as a miss until the entry has expired. `onStoreError: "throw"` keeps the old behaviour. The package now has `@opentelemetry/api` as a peer.
- live: `liveHub.send` never rejects. A lost update is counted on `baseline.live.sends_failed` and logged once per 30 s. When the Redis subscriber reconnects, every open stream sends `ready` again within 1 to 5 s, so pages reread what they missed. The package now has `@opentelemetry/api` as a peer.
- app: no code to change in a Project. Tests show a Use case still answers with the cache store or the hub down, and `docs/agents/pieces.md` states how stale a cached read can be (the entry's lifetime, 60 s by default).
