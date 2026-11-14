// Composition root for consumers and schedules; it never serves pages or the API.
import { healthServerCreate } from "@n8io/baseline-health";
import { queueSchedulesStart } from "@n8io/baseline-queue";
import {
	type ShutdownHandle,
	shutdownHandleCreate,
} from "@n8io/baseline-shutdown";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { fooScheduleCreate } from "#domains/foo/api/index.ts";
import { ENV } from "#env";
import { connectionsOpen } from "./connections.ts";
import { domainsUseCasesCreate } from "./use-cases.ts";

let shutdown: ShutdownHandle | undefined;
const connections = await connectionsOpen({ role: "worker" });
const { events, queue } = connections;
// connectionsOpen refuses a memory database here, so the queue and Events are real.
if (queue === "memory" || events === "memory") {
	throw new Error("The worker needs a real queue");
}
// Liveness is this process only: false when its own poll loops are stuck, which a restart fixes.
// A Postgres outage never fails it, so the Workers running ride a failover out. connectionsOpen
// above is the startup check: it throws while Postgres is unreachable, so a new pod never gets ready.
const health = healthServerCreate({
	isAlive: () => queue.isAlive() && events.isAlive(),
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});

// domain-create: domains-start
const useCases = domainsUseCasesCreate(connections);
// domain-create: domains-end

await events.consumersStart([
	// domain-create: consumers
]);
// Starts the Schedules migrate has synced; it changes none of them.
await queueSchedulesStart({
	env: ENV,
	queue,
	schedules: [
		fooScheduleCreate(useCases.fooUseCases),
		// domain-create: schedules
	],
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
