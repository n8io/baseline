---
"@n8io/baseline-queue": patch
---

`queueOrderedBlockedKeysWatch` takes an optional `clock` in its timing argument: the time, in ms since the epoch, that its checks compare each blocked Event's deletion time and last report against. It defaults to the database's `now()`, so behaviour is unchanged unless a caller passes one; tests use it to move time on without waiting.
