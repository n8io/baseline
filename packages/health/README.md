# @n8io/baseline-health

Liveness and readiness probes on their own port, so a busy or draining app server never hides them.

```sh
pnpm add @n8io/baseline-health
```

## Exports

- `healthServerCreate({ port, isAlive, isShuttingDown })`: serves `/livez` and `/readyz` on plain `node:http`. Bodies are `ok` (200) or `unavailable` (503); any other path is 404.
  - `/livez` is 200 while `isAlive()` is true.
  - `/readyz` is 503 until `ready()`, and again once `isShuttingDown()` is true.
- `HealthServer`: `ready()` marks the process ready; `close()` stops listening.

## Example

```ts
import { healthServerCreate } from "@n8io/baseline-health";
import {
	type ShutdownHandle,
	shutdownHandleCreate,
} from "@n8io/baseline-shutdown";

let shutdown: ShutdownHandle | undefined;
const health = healthServerCreate({
	isAlive: () => queue.isAlive(),
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});

// Once every intake listens:
shutdown = shutdownHandleCreate({
	intakes,
	resources: [...resources, { close: () => health.close(), name: "health" }],
});
health.ready();
```

## Needs

Nothing: no peers and no env. The template's convention is `HEALTH_PORT` (default 9000).
