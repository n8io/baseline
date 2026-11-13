---
"@n8io/baseline-queue": major
"@n8io/baseline-pulsar": major
"app": major
---

Events go through one `Events` handle, whatever carries them, so moving Events from the queue to Pulsar changes one file in a Project instead of every Domain.

`@n8io/baseline-queue` exports `Events` (`consumersSubscribe`, `consumersStart`, `publisherCreate(transaction)`, `isAlive`), `EventsPublisher` (`publish`, then `committed()` once the transaction has committed) and `queueEventsCreate(queue)`. `queueEventsPgBossCreate`, `QueueEvents`, `queueConsumersSubscribe` and `queueConsumersStart` are gone. `queueCreate`, `publisherCreate` and `queueInboxInsert` take a `QueueSql` (anything with `query(text, values?)`), so the package no longer has `pg` or `@types/pg` peers.

`@n8io/baseline-pulsar` exports `pulsarCreate` (its `token` may now be `undefined`) and `pulsarEventsCreate(pulsar)`, which now returns that same `Events`. `PulsarEvents`, `pulsarConsumersSubscribe` and `pulsarConsumersStart` are gone; `send()` is `committed()`.

In the Template, the new `src/events-open.ts` is the only file that names the transport, and `connectionsOpen` returns it as `connections.events`.

When you upgrade:

- In each Domain's `spi/<domain>-transaction.postgres.ts`, take `events: Events` in place of `queue: Queue`, create the publisher with `events.publisherCreate<<Domain>EventMap>(pgClient)`, and call `committed()` on it after `postgresTransactionRun` returns ok. Copy the shape from Foo.
- In each Domain's `spi/index.ts`, read `connections.events` in place of `connections.queue`.
- In `src/server.ts`, call `connections.events.consumersSubscribe([...])`. In `src/worker.ts`, call `events.consumersStart([...])` and report `queue.isAlive() && events.isAlive()`.
- In tests that build a Postgres transaction, pass `queueEventsCreate(queue)`.
- A Project already on Pulsar moves its client into `src/events-open.ts` as the pulsar README shows, and drops its other Pulsar wiring.
