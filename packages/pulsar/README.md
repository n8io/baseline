# @n8io/baseline-pulsar

Events and Consumers on [Apache Pulsar](https://pulsar.apache.org) 5, for a project that has outgrown Events on Postgres. Schedules stay on pg-boss (Pulsar has no cron), so the project keeps `@n8io/baseline-queue` for Schedules and the inbox.

How it differs from the queue package:

- **Sent after commit.** `publish` only buffers; the transaction SPI calls `send()` after the commit and drops the buffer on a rollback. A crash between the commit and the send loses that Event.
- **Topics and subscriptions.** Each Event goes to `persistent://<namespace>/<event name>` (namespace `public/default` unless you pass one). Each Consumer is a Shared subscription named after its `queueName`, so every Worker instance takes a share.
- **Retries and dead letters.** A Consumer that throws is tried five times in all, about 10 s, 20 s, 40 s and 80 s apart, then its Event moves to `<queueName>.dead`, which keeps a subscription of the same name.
- **Duplicates.** Each Event carries an `event-id` property, kept through every retry and the dead letter. It is the inbox `eventId`, so `queueInboxInsert` skips a repeat as before.
- **Tracing.** W3C trace context travels in the message properties. Spans follow the OpenTelemetry messaging conventions: `send <topic>` (producer) and `process <topic>` (consumer).
- **Auth.** None (a local standalone broker) or a JWT for the broker's token authentication.

## Swap it in

1. **Package access.** On GitHub, open the package's settings, then **Manage Actions access**, and add your project's repository. This is a web-only step, once per repository. Then `pnpm add @n8io/baseline-pulsar`, and add `pulsar-client: true` under `allowBuilds` in `pnpm-workspace.yaml` (its install script downloads a prebuilt binary from archive.apache.org).

2. **Environment.** Declare the broker in `.env.schema` (varlock regenerates `src/env.d.ts` on the next run):

   ```sh
   # pulsar:// or pulsar+ssl://
   # @type=url(allowedProtocols=[pulsar, pulsar+ssl])
   PULSAR_URL=
   # A JWT; leave it unset for a local standalone broker
   # @optional
   PULSAR_TOKEN=
   ```

3. **Transaction SPI.** In each Domain's `*-transaction.postgres.ts`, publish into a `pulsarEvents` buffer and send it once the transaction has committed:

   ```ts
   import { type Pulsar, pulsarEvents } from "@n8io/baseline-pulsar";

   export const fooTransactionPostgres = (pgPool: pg.Pool, pulsar: Pulsar): FooTransaction =>
     (async (work, inbox) => {
       const fooEvents = pulsarEvents<FooEventMap>(pulsar);
       const result = await postgresTransaction(pgPool, async (pgClient) => {
         if (inbox && !(await queueInboxInsert(pgClient, inbox))) return ok(undefined);
         // ...the same ports as before, with fooEvents in place of queueEventsPgBoss
       });
       if (result.ok) await fooEvents.send();
       return result;
     }) as FooTransaction;
   ```

4. **Composition roots.** Create one client per process and stop it with the other intakes:

   ```ts
   const pulsar = pulsarCreate({ serviceUrl: ENV.PULSAR_URL, token: ENV.PULSAR_TOKEN });
   ```

   - `src/server.ts`: replace `consumersSubscribe(queue, [...])` with `pulsarConsumersSubscribe(pulsar, [...])`, so the subscriptions exist before the first send. The server no longer needs `queueCreate`: it only published Events and created subscriptions.
   - `src/worker.ts`: replace `consumersStart(queue, [...])` with `pulsarConsumersStart(pulsar, [...])`. Keep `queueCreate` and `schedulesRegister` for Schedules and inbox pruning. Make `/livez` check both: `isAlive: () => queue.isAlive() && pulsar.isAlive()`, and add `{ close: () => pulsar.stop(), name: "pulsar" }` to the intakes.

   Consumers are built with the queue package's `consumerCreate`, unchanged.

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
