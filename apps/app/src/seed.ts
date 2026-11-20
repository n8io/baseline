// Composition root for example data: local development only, never production.
import type { Actor } from "@n8io/baseline-authn";
import { logger } from "@n8io/baseline-logger";
import { telemetryShutdown } from "@n8io/baseline-telemetry";
import { fooScopes } from "#contexts/foo/index.ts";
import { ENV, envLocal } from "#env";
import { connectionsClose, connectionsOpen } from "./connections.ts";
import { type ContextMounts, contextsCreate } from "./contexts.ts";

const devSeedActor: Actor = {
	id: "dev-seed",
	kind: "client",
	scopes: [
		...fooScopes,
		// wiring: scopes
	],
};

// Runs every context's seeds in the order contextsCreate returns the contexts, which is the order
// it builds them in, so a context's seeds run after those of the contexts it reads. A seed ensures
// its rows, so running it again changes nothing.
export const seedsRun = async (mounts: ContextMounts[]) => {
	for (const seed of mounts.flatMap((m) => m.seeds)) {
		await seed(devSeedActor);
	}
};

// True only for `node src/seed.ts`; false when server.ts imports seedsRun.
if (import.meta.main) {
	if (!envLocal) {
		throw new Error(
			`Seeds run only in development and test: APP_ENV is ${ENV.APP_ENV}`,
		);
	}
	if (ENV.DATABASE_URL === "memory://") {
		logger.info("memory database: the Server seeds itself at start");
		process.exit(0);
	}
	const connections = await connectionsOpen({ role: "publisher" });
	await seedsRun([
		// wiring: contexts-start
		...Object.values(contextsCreate(connections)),
		// wiring: contexts-end
	]);
	logger.info("seeds done");

	await connectionsClose(connections);
	await telemetryShutdown();
}
