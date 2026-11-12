// Composition root for example data: local development only, never production.
// The blank line below keeps this comment when the render's Biome pass drops the Actor import.

import type { Actor } from "@n8io/baseline-authn";
import { logger } from "@n8io/baseline-logger";
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
import { connectionsOpen } from "./connections.ts";

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
	const connections = await connectionsOpen(ENV, "publisher");
	// domain-create: domains-start
	const fooUseCases = telemetryUseCasesTrace(
		fooUseCasesCreate(fooPortsCreate(connections)),
	);
	// domain-create: use-cases

	await seedsRun({
		fooUseCases,
		// domain-create: seed-context
	});
	// domain-create: domains-end
	logger.info("seeds done");

	for (const step of [...connections.intakes, ...connections.resources]) {
		await step.close();
	}
	await telemetryShutdown();
}
