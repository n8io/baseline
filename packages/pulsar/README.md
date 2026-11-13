# @n8io/baseline-pulsar

Events and Consumers on [Apache Pulsar](https://pulsar.apache.org) 5, for a project that has outgrown Events on Postgres. Schedules stay on pg-boss (Pulsar has no cron), so the project keeps `@n8io/baseline-queue` for Schedules and the inbox.

How it differs from the queue package:

- **Sent after commit.** `publish` only buffers; the transaction SPI calls `committed()` after the commit, which sends the buffer, and drops the publisher on a rollback. A crash between the commit and the send loses that Event. A send that fails is logged and counted on `baseline.pulsar.events_lost`, by `messaging.destination.name`, so you can alert on it.
- **Topics and subscriptions.** Each Event goes to `persistent://<namespace>/<event name>` (namespace `public/default` unless you pass one). Each Consumer is a Shared subscription named after its `queueName`, so every Worker instance takes a share.
- **Retries and dead letters.** A Consumer that throws is tried five times in all, about 10 s, 20 s, 40 s and 80 s apart, then its Event moves to `<queueName>.dead`, which keeps a subscription of the same name.
- **Duplicates.** Each Event carries an `event-id` property, kept through every retry and the dead letter. It is the inbox `eventId`, so `queueInboxInsert` skips a repeat as before.
- **Tracing.** W3C trace context travels in the message properties. Spans follow the OpenTelemetry messaging conventions: `send <topic>` (producer) and `process <topic>` (consumer).
- **Closing.** `stop()` stops receiving; `close()` stops if needed, flushes producers and closes the client. `await using` calls `close()` when its block ends.
- **Auth.** None (a local standalone broker) or a JWT for the broker's token authentication. Anything else the Pulsar client can do (OAuth2, mTLS, timeouts) goes under `pulsarCreate`'s `vendor` option, which passes the client's own settings through. To build an `authentication` object, add `pulsar-client` to the Project at exactly the version this Package pins, so only one copy of its native addon loads. `vendor` refuses `log`, `serviceUrl` and `serviceUrlProvider` (cluster failover is not supported), and `authentication` together with `token`. It is outside the contract: nothing in it is tested here, and moving off Pulsar deletes it.

## Swap it in

1. **Install.** Run `pnpm add @n8io/baseline-pulsar` (it is public on npmjs), and add `pulsar-client: true` under `allowBuilds` in `pnpm-workspace.yaml` (its install script downloads a prebuilt binary from archive.apache.org).

2. **Environment.** Declare the broker in `.env.schema` (varlock regenerates `src/env.d.ts` on the next run):

   ```sh
   # pulsar:// or pulsar+ssl://; not read while DATABASE_URL is memory://
   # @optional
   # @type=url(allowedProtocols=[pulsar, pulsar+ssl])
   PULSAR_URL=
   # A JWT; leave it unset for a local standalone broker
   # @optional
   PULSAR_TOKEN=
   ```

3. **Open Events on Pulsar.** `src/events-open.ts` is the only file that names the Events transport. Replace its body; its caller in `src/connections.ts` already passes everything it needs:

   ```ts
   // src/events-open.ts
   import { pulsarCreate, pulsarEventsCreate } from "@n8io/baseline-pulsar";
   import type { Events, Queue } from "@n8io/baseline-queue";
   import type { ShutdownStep } from "@n8io/baseline-shutdown";
   import { ENV } from "#env";

   export const eventsOpen = ({
   	intakes,
   	queue,
   	resources,
   	role,
   }: {
   	queue: Queue | "memory";
   	role: "publisher" | "worker";
   	intakes: ShutdownStep[];
   	resources: ShutdownStep[];
   }): Events | "memory" => {
   	// Events are real exactly when the database is; the queue is "memory" with a memory database.
   	if (queue === "memory") return "memory";
   	if (!ENV.PULSAR_URL) throw new Error("PULSAR_URL is not set");
   	const pulsar = pulsarCreate({
   		serviceUrl: ENV.PULSAR_URL,
   		token: ENV.PULSAR_TOKEN,
   	});
   	// stop() is an intake: it stops receiving and lets running Consumers finish.
   	if (role === "worker") {
   		intakes.push({ close: () => pulsar.stop(), name: "pulsar consumers" });
   	}
   	// close() is a resource: it flushes what was sent, so it goes before the database.
   	resources.unshift({ close: () => pulsar.close(), name: "pulsar" });
   	return pulsarEventsCreate(pulsar);
   };
   ```

   Nothing else changes. Each Domain's transaction, `src/server.ts`, `src/worker.ts` and `src/seed.ts` already go through `connections.events` and the shutdown lists: they publish, call `committed()`, subscribe, start Consumers, report `/livez` and close the same way on either transport. The queue stays open for Schedules and inbox pruning. Consumers are built with the queue package's `queueConsumerCreate`, unchanged.

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
