// Composition root for example data: local development only, never production.
// The blank line below keeps this comment when the render's Biome pass drops the Actor import.

import type { Actor } from "@n8io/baseline-authn";
import { logger } from "@n8io/baseline-logger";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { fooSeed } from "#domains/foo/api/index.ts";
import { fooScopes } from "#domains/foo/index.ts";
import { ENV, envLocal } from "#env";
import { connectionsOpen } from "./connections.ts";
import { type DomainsUseCases, domainsUseCasesCreate } from "./use-cases.ts";

// domain-create: domains-start
const devSeedActor: Actor = {
	id: "dev-seed",
	kind: "client",
	scopes: [
		...fooScopes,
		// domain-create: scopes
	],
};

// A seed ensures its rows and returns them all, so a later seed can take the ids it needs:
// `const things = await thingSeed(...)`, then `await partSeed(..., { things })`.
export const seedsRun = async (useCases: DomainsUseCases) => {
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
	const connections = await connectionsOpen({ role: "publisher" });
	// domain-create: domains-start
	await seedsRun(domainsUseCasesCreate(connections));
	// domain-create: domains-end
	logger.info("seeds done");

	for (const step of [...connections.intakes, ...connections.resources]) {
		await step.close();
	}
	await telemetryShutdown();
}
