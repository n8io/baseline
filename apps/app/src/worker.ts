// Composition root for Event handlers and Schedules; it never serves pages or the API.
import { healthServerCreate } from "@n8io/baseline-health";
import { logger } from "@n8io/baseline-logger";
import { queueSchedulesStart } from "@n8io/baseline-queue";
import {
	type ShutdownHandle,
	shutdownHandleCreate,
} from "@n8io/baseline-shutdown";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { ENV } from "#env";
import { connectionsOpen } from "./connections.ts";
import { type ContextMounts, contextsCreate } from "./contexts.ts";

let shutdown: ShutdownHandle | undefined;
const connections = await connectionsOpen({ role: "worker" }).catch((error) => {
	logger.fatal({ err: error }, "Boot failed: a connection did not open");
	process.exit(1);
});
const { events, queue } = connections;
// connectionsOpen refuses a memory database here, so the queue and Events are real.
if (queue === "memory" || events === "memory") {
	throw new Error("The Worker needs a real queue");
}
// Liveness is this process only: false when its own poll loops are stuck, which a restart fixes.
// A Postgres outage never fails it, so the Workers running ride a failover out. connectionsOpen
// above is the startup check: it throws while Postgres is unreachable, so a new pod never gets ready.
const health = healthServerCreate({
	isAlive: () => queue.isAlive() && events.isAlive(),
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});

// Every context, built in order; the Worker runs each one's handlers and schedules.
const mounts: ContextMounts[] = [
	// wiring: contexts-start
	...Object.values(contextsCreate(connections)),
	// wiring: contexts-end
];

await events.consumersStart(mounts.flatMap((m) => m.handlers));
// Starts the Schedules migrate has synced; it changes none of them.
await queueSchedulesStart({
	env: ENV,
	queue,
	schedules: mounts.flatMap((m) => m.schedules),
});

shutdown = shutdownHandleCreate({
	// No load balancer sends the Worker traffic, so there is nothing to drain first.
	drainDelayMs: 0,
	intakes: connections.intakes,
	resources: [
		...connections.resources,
		{ close: () => health.close(), name: "health" },
		{ close: () => telemetryShutdown(), name: "telemetry" },
	],
});
health.ready();
