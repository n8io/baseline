# @n8io/baseline-pulsar

Events and Consumers on [Apache Pulsar](https://pulsar.apache.org) 5, for a project that has outgrown Events on Postgres. Schedules stay on pg-boss (Pulsar has no cron), so the project keeps `@n8io/baseline-queue` for Schedules and the inbox.

How it differs from the queue package:

- **Sent after commit.** `publish` only buffers; the transaction SPI calls `send()` after the commit and drops the buffer on a rollback. A crash between the commit and the send loses that Event. A send that fails is logged and counted on `baseline.pulsar.events_lost`, by `messaging.destination.name`, so you can alert on it.
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

3. **Transaction SPI.** In each Domain's `*-transaction.postgres.ts`, take a `Pulsar` instead of the `Queue`, publish into a `pulsarEventsCreate` buffer behind the same guard, and send it once the transaction has committed:

   ```ts
   import { type Pulsar, pulsarEventsCreate } from "@n8io/baseline-pulsar";

   export const fooTransactionPostgresCreate = (pgPool: pg.Pool, pulsar: Pulsar): FooTransaction =>
     (async (work, inbox) => {
       const fooEvents = pulsarEventsCreate<FooEventMap>(pulsar);
       const result = await postgresTransactionRun(pgPool, async (pgClient) => {
         if (inbox && !(await queueInboxInsert(pgClient, inbox))) return ok(undefined);
         let open = true;
         const isOpen = (): boolean => open;
         try {
           return await work({
             fooEvents: transactionPortsGuard(fooEvents, isOpen),
             fooRepository: transactionPortsGuard(fooRepositoryPostgresCreate(drizzle({ client: pgClient })), isOpen),
           });
         } finally {
           open = false;
         }
       });
       if (result.ok) await fooEvents.send();
       return result;
     }) as FooTransaction;
   ```

   In `spi/index.ts`, `fooPortsCreate` takes `pulsar: Pulsar | "memory"` in place of `queue`, with the same both-real-or-both-memory check against `database`.

4. **Composition roots.** Every root that builds ports creates one client, or `"memory"` when `PULSAR_URL` is `memory://` (allow that protocol in `.env.schema` as `DATABASE_URL` does):

   ```ts
   const pulsar = ENV.PULSAR_URL === "memory://"
     ? "memory"
     : pulsarCreate({ serviceUrl: ENV.PULSAR_URL, token: ENV.PULSAR_TOKEN });
   ```

   `stop()` is an intake: it stops receiving and lets running Consumers finish. `close()` is a resource: it flushes what was sent and closes the client, so list it before `database`, after every intake that may still send.
   - `src/server.ts`: replace `queueConsumersSubscribe(queue, [...])` with `pulsarConsumersSubscribe(pulsar, [...])`, so the subscriptions exist before the first send. Drop `queueCreate`: the server used the Queue only to publish. Replace the `queue` resource and the `queue.stop()` in `serverDevClose` with `pulsar.close()`.
   - `src/worker.ts`: replace `queueConsumersStart(queue, [...])` with `pulsarConsumersStart(pulsar, [...])`. Keep `queueCreate` and `queueSchedulesRegister` for Schedules and inbox pruning, and pass both to the ports. Check both in `/livez` (`queue.isAlive() && pulsar.isAlive()`), add `pulsar.stop()` to the intakes beside `queue.stop()`, and `pulsar.close()` to the resources.
   - `src/seed.ts`: create the client in place of the Queue, pass it to the ports, and `close()` it where the seed now calls `queue.stop()`.

   Consumers are built with the queue package's `queueConsumerCreate`, unchanged.

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
