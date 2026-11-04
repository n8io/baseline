// Composition root for example data: local development only, never production.
import type { Actor } from "@n8io/baseline-authn";
import { cacheRedisClientCreate } from "@n8io/baseline-cache";
import { liveMemory, liveRedis } from "@n8io/baseline-live";
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
	const redisClient =
		ENV.CACHE_URL === "memory://"
			? "memory"
			: await cacheRedisClientCreate({ cacheUrl: ENV.CACHE_URL });
	const queue = await queueCreate({ pgPool, role: "publisher" });
	const liveHub =
		redisClient === "memory" ? liveMemory() : liveRedis(redisClient);
	const ports = {
		cache: redisClient,
		database: pgPool,
		liveHub,
		queue,
	} as const;

	const fooUseCases = telemetryUseCasesTrace(
		fooUseCasesCreate(fooPortsCreate(ports)),
	);
	// domain-create: use-cases

	await seedsRun({
		fooUseCases,
		// domain-create: seed-context
	});
	logger.info("seeds done");

	await queue.stop();
	await liveHub.close();
	await pgPool.end();
	if (redisClient !== "memory") await redisClient.close();
	await telemetryShutdown();
}
