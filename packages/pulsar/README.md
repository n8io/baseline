# @n8io/baseline-pulsar

Events and Consumers on [Apache Pulsar](https://pulsar.apache.org) 5, for a project that has outgrown Events on Postgres. Schedules stay on pg-boss (Pulsar has no cron), so the project keeps `@n8io/baseline-queue` for Schedules and the inbox.

How it differs from the queue package:

- **Sent after commit.** `publish` only buffers; the transaction SPI calls `committed()` after the commit, which sends the buffer, and drops the publisher on a rollback. A crash between the commit and the send loses that Event. A send that fails is logged and counted on `baseline.pulsar.events_lost`, by `messaging.destination.name`, so you can alert on it.
- **Topics and subscriptions.** Each Event goes to `persistent://<namespace>/<event name>` (namespace `public/default` unless you pass one). Each Consumer is a Shared subscription named after its `queueName`, so every Worker instance takes a share.
- **Retries and dead letters.** A Consumer that throws is tried five times in all, about 10 s, 20 s, 40 s and 80 s apart, then its Event moves to `<queueName>.dead`, which keeps a subscription of the same name.
- **Duplicates.** Each Event carries an `event-id` property, kept through every retry and the dead letter. It is the inbox `eventId`, so `queueInboxInsert` skips a repeat as before.
- **Tracing.** W3C trace context travels in the message properties. Spans follow the OpenTelemetry messaging conventions: `send <topic>` (producer) and `process <topic>` (consumer).
- **Auth.** None (a local standalone broker) or a JWT for the broker's token authentication.

## Swap it in

1. **Install.** Run `pnpm add @n8io/baseline-pulsar` (it is public on npmjs), and add `pulsar-client: true` under `allowBuilds` in `pnpm-workspace.yaml` (its install script downloads a prebuilt binary from archive.apache.org).

2. **Environment.** Declare the broker in `.env.schema` (varlock regenerates `src/env.d.ts` on the next run):

   ```sh
   # pulsar:// or pulsar+ssl://
   # @type=url(allowedProtocols=[pulsar, pulsar+ssl])
   PULSAR_URL=
   # A JWT; leave it unset for a local standalone broker
   # @optional
   PULSAR_TOKEN=
   ```

3. **Open Events on Pulsar.** `src/events-open.ts` is the only file that names the Events transport. Replace it, and pass it what it now needs from `src/connections.ts`:

   ```ts
   // src/events-open.ts
   import type { Events } from "@n8io/baseline-queue";
   import type { ShutdownStep } from "@n8io/baseline-shutdown";
   import { pulsarCreate, pulsarEventsCreate } from "@n8io/baseline-pulsar";

   export const eventsOpen = (
     env: { PULSAR_URL: string; PULSAR_TOKEN?: string },
     database: unknown,
     role: "publisher" | "worker",
     intakes: ShutdownStep[],
     resources: ShutdownStep[],
   ): Events | "memory" => {
     // Events are real exactly when the database is.
     if (database === "memory") return "memory";
     const pulsar = pulsarCreate({ serviceUrl: env.PULSAR_URL, token: env.PULSAR_TOKEN });
     // stop() is an intake: it stops receiving and lets running Consumers finish.
     if (role === "worker") intakes.push({ close: () => pulsar.stop(), name: "pulsar consumers" });
     // close() is a resource: it flushes what was sent, so it goes before the database.
     resources.unshift({ close: () => pulsar.close(), name: "pulsar" });
     return pulsarEventsCreate(pulsar);
   };
   ```

   ```ts
   // src/connections.ts
   events: eventsOpen(env, database, role, intakes, resources),
   ```

   Nothing else changes. Each Domain's transaction, `src/server.ts` and `src/worker.ts` already go through `connections.events`: they publish, call `committed()`, subscribe, start Consumers and report `/livez` the same way on either transport. The queue stays open for Schedules and inbox pruning. Consumers are built with the queue package's `queueConsumerCreate`, unchanged.

4. **Tests.** Tests that build a Domain's Postgres transaction pass `queueEventsCreate(queue)`; they keep working, on the queue. To test on Pulsar, pass `pulsarEventsCreate(pulsar)` there.

5. **Local broker.** Add Pulsar to `compose.yaml` and set `PULSAR_URL=pulsar://localhost:6650` in `.env`:

   ```yaml
   pulsar:
     image: apachepulsar/pulsar:5.0.1
     command: bin/pulsar standalone --no-functions-worker --no-stream-storage
     ports:
       - "6650:6650"
       - "8080:8080"
     healthcheck:
       test: ["CMD", "curl", "-f", "http://localhost:8080/admin/v2/brokers/health"]
       interval: 5s
       retries: 24
   ```

   In CI, start the same image as a service before the integration tests.
