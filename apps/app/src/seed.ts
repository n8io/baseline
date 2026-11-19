// Composition root for example data: local development only, never production.
// The blank line below keeps this comment when the render's Biome pass drops the Actor import.

import type { Actor } from "@n8io/baseline-authn";
import { logger } from "@n8io/baseline-logger";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { fooSeed } from "#contexts/foo/adapters/inbound/index.ts";
import { fooScopes } from "#contexts/foo/index.ts";
import { ENV, envLocal } from "#env";
import { connectionsOpen } from "./connections.ts";
import { type DomainsUseCases, domainsUseCasesCreate } from "./use-cases.ts";

// wiring: contexts-start
const devSeedActor: Actor = {
	id: "dev-seed",
	kind: "client",
	scopes: [
		...fooScopes,
		// wiring: scopes
	],
};

// A seed ensures its rows and returns them all, so a later seed can take the ids it needs:
// `const things = await thingSeed(...)`, then `await partSeed(..., { things })`.
export const seedsRun = async (useCases: DomainsUseCases) => {
	await fooSeed(useCases.fooUseCases, devSeedActor);
	// wiring: seeds
};
// wiring: contexts-end

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
	// wiring: contexts-start
	await seedsRun(domainsUseCasesCreate(connections));
	// wiring: contexts-end
	logger.info("seeds done");

	for (const step of [...connections.intakes, ...connections.resources]) {
		await step.close();
	}
	await telemetryShutdown();
}
