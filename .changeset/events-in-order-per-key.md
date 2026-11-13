---
"@n8io/baseline-queue": major
"@n8io/baseline-pulsar": major
"app": major
---

Events are kept in order per Event key, and Consumers fetch them in batches.

- **Breaking:** `EventsPublisher.publish` takes one object with a required, non-empty `key`: `publish({ name, data, key })`. The key is the Event key, the id of the entity the Event is about. `queueEventsMemoryCreate` records the key too. In a Project, every `publish(name, data)` becomes `publish({ name, data, key })`, and the Domain's `<domain>Events` port and memory state gain `key`.
- Each Consumer gets the Events of one Event key one at a time, in the order their transactions committed, on any number of workers; other keys run beside them. A worker fetches up to 10 Events at once and runs 4 at a time, and a backlog drains without waiting for a poll (measured: about 1,100 Events a second over 50 keys on 12 workers, about 170 a second on one busy key).
- An Event that fails all five attempts now stays in its queue and holds back its Event key, with a copy in `<queueName>.dead`. `queue.blockedKeys()` lists blocked keys, the worker logs each at error level, and the queue README has the runbook to run the Event again or give it up.
- A worker that dies mid-Event or mid-Schedule is noticed within about a minute (it was 15), and a Consumer that runs longer than five minutes is failed and retried.
- Upgrading needs no step: Consumer queues move to `<queueName>.ordered`, the old queues are drained during the rollout and removed by a later `queueMigrate`. See "Upgrading to 8" in the queue README.
- `@n8io/baseline-pulsar` takes the same `publish({ name, data, key })` and sends the key as the partition key. Order per Event key on Pulsar is not guaranteed yet.
- `events-and-bridges.md` gains the Event key, the ordering guarantee and the rule for changing an Event's shape across a rollout. "Event key" is a glossary term.
