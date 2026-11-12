// Composition root for example data: local development only, never production.
// The blank line below keeps this comment when the render's Biome pass drops the Actor import.

import type { Actor } from "@n8io/baseline-authn";
import { liveHubMemoryCreate, liveHubRedisCreate } from "@n8io/baseline-live";
import { logger } from "@n8io/baseline-logger";
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import { queueCreate } from "@n8io/baseline-queue";
import {
	telemetryShutdown,
	telemetryUseCasesTrace,
} from "@n8io/baseline-telemetry";
import { fooSeed } from "#domains/foo/api/index.ts";
import {
	type FooUseCases,
	fooScopes,
	fooUseCasesCreate,
} from "#domains/foo/index.ts";
import { fooPortsCreate } from "#domains/foo/spi/index.ts";
import { ENV, envLocal } from "#env";
import { redisClientCreate } from "./redis.ts";

// domain-create: domains-start
const devSeedActor: Actor = {
	id: "dev-seed",
	kind: "client",
	scopes: [
		...fooScopes,
		// domain-create: scopes
	],
};

export const seedsRun = async (useCases: {
	fooUseCases: FooUseCases;
	// domain-create: seed-types
}) => {
	await fooSeed(useCases.fooUseCases, devSeedActor);
	// domain-create: seeds
};
// domain-create: domains-end

// True only for `node src/seed.ts`; false when server.ts imports seedsRun.
if (import.meta.main) {
	if (!envLocal) {
		throw new Error(
			`Seeds run only in development and test: APP_ENV is ${ENV.APP_ENV}`,
		);
	}
	if (ENV.DATABASE_URL === "memory://") {
		logger.info("memory database: the server seeds itself at start");
		process.exit(0);
	}
	const pgPool = postgresPoolCreate({ databaseUrl: ENV.DATABASE_URL });
	// piece-start: redis
	const redisClient =
		ENV.CACHE_URL === "memory://"
			? "memory"
			: await redisClientCreate(ENV.CACHE_URL);
	// piece-end: redis
	// piece-start: queue
	const queue = await queueCreate({ pgPool, role: "publisher" });
	// piece-end: queue
	// piece-start: live
	const liveHub =
		redisClient === "memory"
			? liveHubMemoryCreate()
			: liveHubRedisCreate(redisClient);
	// piece-end: live
	// domain-create: domains-start
	const ports = {
		// piece-start: cache
		cache: redisClient,
		// piece-end: cache
		database: pgPool,
		// piece-start: live
		liveHub,
		// piece-end: live
		// piece-start: queue
		queue,
		// piece-end: queue
	} as const;

	const fooUseCases = telemetryUseCasesTrace(
		fooUseCasesCreate(fooPortsCreate(ports)),
	);
	// domain-create: use-cases

	await seedsRun({
		fooUseCases,
		// domain-create: seed-context
	});
	// domain-create: domains-end
	logger.info("seeds done");

	// piece-start: queue
	await queue.stop();
	// piece-end: queue
	// piece-start: live
	await liveHub.close();
	// piece-end: live
	await pgPool.end();
	// piece-start: redis
	if (redisClient !== "memory") await redisClient.close();
	// piece-end: redis
	await telemetryShutdown();
}
