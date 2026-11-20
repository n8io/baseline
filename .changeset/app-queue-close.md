---
"app": major
---

The Template closes the queue with `queue.close()` and records Events in its memory transaction with `queueEventsPublisherMemoryCreate`, the names `@n8io/baseline-queue` 9 uses. After the upgrade, rename both in each context's own code: `queue.stop()` becomes `queue.close()` in its repository and Use case Postgres tests, and `queueEventsMemoryCreate` becomes `queueEventsPublisherMemoryCreate` in `adapters/outbound/<aggregate>-transaction.memory.ts` (see the Template's `foo-transaction.memory.ts`).
