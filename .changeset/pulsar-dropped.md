---
"@n8io/baseline-queue": major
"app": patch
---

Baseline no longer supports Apache Pulsar. `@n8io/baseline-pulsar` is removed from the repo and gets no further releases; Events run on the queue alone.

- **Breaking:** queue no longer exports `queueJobRun` or `queueRetryLimit`, which only the pulsar package used.
- app: `eventsOpen(queue)` in `src/events-open.ts` takes the queue alone, and only the composition roots, `src/authn.ts` and `src/connections.ts` read `#env` (rule A22). The docs drop their Pulsar notes. To upgrade, change `src/events-open.ts` and its call in `src/queue-open.ts` to match. A Project still on Pulsar keeps its pinned 4.x release, which works with queue 7 only.
