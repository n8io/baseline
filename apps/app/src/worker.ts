// Composition root for consumers and schedules; it never serves pages or the API.
import { healthServerCreate } from "@n8io/baseline-health";
import { queueSchedulesRegister } from "@n8io/baseline-queue";
import {
	type ShutdownHandle,
	shutdownHandleCreate,
} from "@n8io/baseline-shutdown";
import {
	telemetryShutdown,
	telemetryUseCasesTrace,
} from "@n8io/baseline-telemetry";
import { fooScheduleCreate } from "#domains/foo/api/index.ts";
import { fooUseCasesCreate } from "#domains/foo/index.ts";
import { fooPortsCreate } from "#domains/foo/spi/index.ts";
import { ENV, envLocal } from "#env";
import { connectionsOpen } from "./connections.ts";

let shutdown: ShutdownHandle | undefined;
const connections = await connectionsOpen({ role: "worker" });
const { events, queue } = connections;
// connectionsOpen refuses a memory database here, so the queue and Events are real.
if (queue === "memory" || events === "memory") {
	throw new Error("The worker needs a real queue");
}
const health = healthServerCreate({
	isAlive: () => queue.isAlive() && events.isAlive(),
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});

const fooUseCases = telemetryUseCasesTrace(
	fooUseCasesCreate(fooPortsCreate(connections)),
);
// domain-create: use-cases
// domain-create: bridges

await events.consumersStart([
	// domain-create: consumers
]);
await queueSchedulesRegister(
	queue,
	[
		fooScheduleCreate(fooUseCases),
		// domain-create: schedules
	],
	{ env: ENV },
);

shutdown = shutdownHandleCreate({
	drainDelayMs: envLocal ? 0 : 5_000,
	intakes: connections.intakes,
	resources: [
		...connections.resources,
		{ close: () => health.close(), name: "health" },
		{ close: () => telemetryShutdown(), name: "telemetry" },
	],
});
health.ready();
