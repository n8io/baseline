---
"@n8io/baseline-queue": minor
---

A blocked Event key is now hard to miss. The once-a-minute watch in every Worker logs a blocked key at error level with an `err` (`QueueBlockedKeyError`, whose message names the Consumer but never a key), so it reaches error tracking, and logs it again every 24 hours while it stays blocked. From 24 hours before the queue deletes the failed Event it warns with that time, and when the queue has deleted it unreleased it logs at error (`QueueBlockedKeyExpiredError`) and adds to the counter `baseline.queue.blocked_keys_expired`. Two new gauges per Consumer: `baseline.queue.blocked_key_age` (seconds since the oldest blocked key failed) and `baseline.queue.blocked_key_waiting` (Events waiting behind blocked keys). `blockedKeys()` also returns `deleteAt`, when the queue deletes the failed Event unless it is released first.
