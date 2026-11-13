# @n8io/baseline-pulsar

Events and Consumers on [Apache Pulsar](https://pulsar.apache.org) 5, for a project that has outgrown Events on Postgres. Schedules stay on pg-boss (Pulsar has no cron), so the project keeps `@n8io/baseline-queue` for Schedules and the inbox.

How it differs from the queue package:

- **Sent after commit.** `publish` only buffers; the transaction SPI calls `committed()` after the commit, which sends the buffer, and drops the publisher on a rollback. A crash between the commit and the send loses that Event. A send that fails is logged and counted on `baseline.pulsar.events_lost`, by `messaging.destination.name`, so you can alert on it.
- **Topics and subscriptions.** Each Event goes to `persistent://<namespace>/<event name>` (namespace `public/default` unless you pass one), with its Event key as the message's key. Each Consumer is one subscription named after its `queueName`, shared by every Worker instance.
- **Order.** Each Consumer gets the Events of one Event key one at a time, in the order the broker received them, however many Workers run; other keys run beside them. A Worker holds up to four Events per Consumer at once, so a key with a backlog whose Events keep failing can fill all four, and the other keys of that Worker wait until each has had its five attempts. `publish` refuses an empty key, as the queue does. One limit the queue does not have: the send happens after the commit, so two transactions on one entity that commit within milliseconds of each other on different instances can reach the broker in either order.
- **Retries.** A Consumer that throws is tried five times in all, about 10 s, 20 s, 40 s and 80 s apart. The Worker keeps the Event while it waits, so later Events of the same key wait behind it and cannot pass it. A Worker that stops while an Event waits hands it back to the broker, and the next Worker starts again at the first attempt, at once.
- **Dead letters.** After the fifth failed attempt the Worker copies the Event to `<queueName>.dead`, under a subscription of the same name, and **its key moves on**. This differs from the queue, where such an Event blocks its key until someone releases it: Pulsar has no way to park one key that is visible and releasable, so there is no `blockedKeys()` here. Alert on the error log "Job failed; moved to dead letter" or the `baseline.queue.dead_letters` counter, both written when the fifth attempt fails, and expect the later Events of that key to have run without the failed one. The copy is sent until it arrives ("Dead letter not sent" is logged while the broker is away), and a Worker that stops in between leaves the Event to the next Worker, so a dead letter can appear twice under one `event-id`. Read dead letters with a Shared subscription; an Exclusive reader on that name makes the next dead letter wait until it disconnects.
- **Liveness.** `isAlive()` is false only when a Consumer's receive loop has not come round for 60 s, which only a restart can fix. A broker that cannot be reached does not fail it: the Worker stays up, reconnects by itself and carries on. Events published during the outage are lost and counted, as above.
- **Duplicates.** Each Event carries an `event-id` property, kept through every retry and the dead letter. It is the inbox `eventId`, so `queueInboxInsert` skips a repeat as before. The broker sends Events again after a Worker stops or dies while holding them, together with Events of the same key that Worker had just finished, and the next Worker runs them in their old order. So a Consumer that must not repeat or step back uses the inbox.
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

3. **Open Events on Pulsar.** `src/events-open.ts` is the only file that names the Events transport. Replace its body; its caller in `src/queue-open.ts` already passes everything it needs, and calls it only when the database is real:

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
   	queue: Queue;
   	role: "publisher" | "worker";
   	intakes: ShutdownStep[];
   	resources: ShutdownStep[];
   }): Events => {
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

## Upgrading to 5

Version 5 changes each Consumer's subscription from Shared to Key_Shared, and the broker refuses the new type while a consumer of the old type is connected ("ConsumerBusy"). So this upgrade is not a rolling update:

1. Scale the Workers of the old release to zero. Servers keep publishing; the subscriptions keep those Events.
2. Deploy the new release, Servers and Workers.

The new Workers pick up what waited. A new Server or Worker that boots while an old Worker is still connected fails at boot and is restarted until the old ones are gone. Events sent by Servers of the old release during the rollout are batched across keys, so they may run out of order until every Server is on the new release.
