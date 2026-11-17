---
"@n8io/baseline-queue": minor
---

`queue.blockedKeyRetry({ consumer, key })` and `queue.blockedKeyGiveUp({ consumer, key })` release a blocked Event key without SQL: the first runs the failed Event again before the Events waiting behind it, the second gives it up so the key moves on (its copy in `<queueName>.dead` stays). Both resolve `false` when that Consumer has no blocked Event for that key, and both work on a `"publisher"` Queue. The README runbook leads with them; the SQL stays as a fallback for when only psql is at hand.
