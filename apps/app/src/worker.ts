// Composition root for consumers and schedules; it never serves pages or the API.
import { healthServerCreate } from "@n8io/baseline-health";
import { liveHubMemoryCreate, liveHubRedisCreate } from "@n8io/baseline-live";
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import {
	queueConsumersStart,
	queueCreate,
	queueSchedulesRegister,
} from "@n8io/baseline-queue";
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
import { redisClientCreate } from "./redis.ts";

if (ENV.DATABASE_URL === "memory://") {
	throw new Error(
		"The worker needs a real database: DATABASE_URL is memory://",
	);
}
let shutdown: ShutdownHandle | undefined;
const pgPool = postgresPoolCreate({ databaseUrl: ENV.DATABASE_URL });
// piece-start: redis
const redisClient =
	ENV.CACHE_URL === "memory://"
		? "memory"
		: await redisClientCreate(ENV.CACHE_URL);
// piece-end: redis
const queue = await queueCreate({ pgPool, role: "worker" });
// piece-start: live
const liveHub =
	redisClient === "memory"
		? liveHubMemoryCreate()
		: liveHubRedisCreate(redisClient);
// piece-end: live
const health = healthServerCreate({
	isAlive: () => queue.isAlive(),
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});
// domain-create: domains-start
const ports = {
	// piece-start: cache
	cache: redisClient,
	// piece-end: cache
	database: pgPool,
	// piece-start: live
	liveHub,
	// piece-end: live
	queue,
} as const;
// domain-create: domains-end

const fooUseCases = telemetryUseCasesTrace(
	fooUseCasesCreate(fooPortsCreate(ports)),
);
// domain-create: use-cases
// domain-create: bridges

await queueConsumersStart(queue, [
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
	intakes: [{ close: () => queue.stop(), name: "queue" }],
	resources: [
		// piece-start: live
		{ close: () => liveHub.close(), name: "live" },
		// piece-end: live
		{ close: () => pgPool.end(), name: "database" },
		// piece-start: redis
		{
			close: () =>
				redisClient === "memory" ? Promise.resolve() : redisClient.close(),
			name: "redis",
		},
		// piece-end: redis
		{ close: () => health.close(), name: "health" },
		{ close: () => telemetryShutdown(), name: "telemetry" },
	],
});
health.ready();
