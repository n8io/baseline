---
"@n8io/baseline-queue": minor
---

New export `QueueBlockedKey` (`{ consumer, key }`), the type `blockedKeyRetry` and `blockedKeyGiveUp` take and `blockedKeys()` lists. queueCreate refuses an unknown `role` with a `TypeError` (`queueCreate: role must be "publisher" or "worker", found "x"`), where it used to open a publisher. README: one Exports shape, the memory publisher serves `memory://` in development too, and each options field has a doc comment.
