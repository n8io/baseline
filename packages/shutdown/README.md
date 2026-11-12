# @n8io/baseline-shutdown

Graceful shutdown in a fixed order: stop taking work, let running work finish, then close resources one by one.

```sh
pnpm add @n8io/baseline-shutdown
```

## Exports

- `shutdownHandleCreate({ intakes, resources, deadlineMs?, drainDelayMs? })`: owns `SIGTERM`, `SIGINT`, `uncaughtException` and `unhandledRejection`, and exits the process: 0 when every step closed in time, 1 otherwise or after a crash.
  1. Waits `drainDelayMs` (default 5 s; pass 0 outside production) while readiness answers 503.
  2. Closes every intake (HTTP server, live streams, Consumers) at once.
  3. Closes each resource (queue, pools, clients, health, telemetry last) in order.
  4. Gives up at `deadlineMs` (default 25 s), keeping the last 5 s for the resources.
- `ShutdownHandle`: `isShuttingDown()`, for `/readyz`.
- `ShutdownStep`: `{ name, close }`.

## Example

```ts
import { httpServerClose } from "@n8io/baseline-http";
import { shutdownHandleCreate } from "@n8io/baseline-shutdown";
import { telemetryShutdown } from "@n8io/baseline-telemetry";

const shutdown = shutdownHandleCreate({
	drainDelayMs: envLocal ? 0 : 5_000,
	intakes: [
		{ close: () => httpServerClose(server), name: "http" },
		{ close: () => liveHub.close(), name: "live" },
	],
	resources: [
		{ close: () => queue.stop(), name: "queue" },
		{ close: () => pgPool.end(), name: "database" },
		{ close: () => health.close(), name: "health" },
		{ close: () => telemetryShutdown(), name: "telemetry" },
	],
});
```

## Needs

Nothing beyond `@n8io/baseline-logger`, which it logs each failed step through. No env.
