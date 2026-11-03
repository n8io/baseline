// Composition root for consumers and schedules; it never serves pages or the API.
import { cacheRedisClientCreate } from "@n8io/baseline-cache";
import { healthServerCreate } from "@n8io/baseline-health";
import { liveMemory, liveRedis } from "@n8io/baseline-live";
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import {
	consumersStart,
	queueCreate,
	queueStop,
	schedulesRegister,
} from "@n8io/baseline-queue";
import { shutdownHandle } from "@n8io/baseline-shutdown";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { ENV, envLocal } from "#env";

if (ENV.DATABASE_URL === "memory://") {
	throw new Error(
		"The worker needs a real database: DATABASE_URL is memory://",
	);
}
let shutdown: { isShuttingDown(): boolean } | undefined;
const pgPool = postgresPoolCreate({ databaseUrl: ENV.DATABASE_URL });
const redisClient =
	ENV.CACHE_URL === "memory://"
		? "memory"
		: await cacheRedisClientCreate({ cacheUrl: ENV.CACHE_URL });
const queue = await queueCreate({ pgPool, role: "worker" });
const liveHub =
	redisClient === "memory" ? liveMemory() : liveRedis(redisClient);
const health = healthServerCreate({
	isAlive: () => queue.isAlive(),
	isShuttingDown: () => shutdown?.isShuttingDown() ?? false,
	port: ENV.HEALTH_PORT,
});

// domain-create: use-cases
// domain-create: bridges

await consumersStart(queue, [
	// domain-create: consumers
]);
await schedulesRegister(
	queue,
	[
		// domain-create: schedules
	],
	{ env: process.env },
);

shutdown = shutdownHandle({
	drainDelayMs: envLocal ? 0 : 5_000,
	intakes: [{ close: () => queueStop(queue), name: "queue" }],
	resources: [
		{ close: () => liveHub.close(), name: "live" },
		{ close: () => pgPool.end(), name: "database" },
		{
			close: () =>
				redisClient === "memory" ? Promise.resolve() : redisClient.close(),
			name: "cache",
		},
		{ close: () => health.close(), name: "health" },
		{ close: () => telemetryShutdown(), name: "telemetry" },
	],
});
health.ready();
