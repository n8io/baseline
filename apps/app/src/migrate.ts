// Composition root for migrations: run once per deploy, before the new version starts.
import { logger } from "@n8io/baseline-logger";
import { postgresMigrate } from "@n8io/baseline-postgres";
import { queueMigrate } from "@n8io/baseline-queue";
import { ENV } from "#env";

if (ENV.DATABASE_URL === "memory://") {
	logger.info("memory database: nothing to migrate");
	process.exit(0);
}
await postgresMigrate({
	databaseUrl: ENV.DATABASE_URL,
	migrationsFolder: "./migrations",
});
// piece-start: queue
await queueMigrate({ databaseUrl: ENV.DATABASE_URL });
// piece-end: queue
