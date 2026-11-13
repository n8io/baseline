// Composition root for migrations: run once per deploy, before the new version starts.
import { logger } from "@n8io/baseline-logger";
import { postgresMigrate } from "@n8io/baseline-postgres";
import { queueMigrate, queueSchedulesSync } from "@n8io/baseline-queue";
import { fooSchedule } from "#domains/foo/api/index.ts";
import { ENV } from "#env";

if (ENV.DATABASE_URL === "memory://") {
	logger.info("memory database: nothing to migrate");
	process.exit(0);
}
// Postgres itself where DATABASE_URL is a connection pooler: postgresMigrate refuses one.
const databaseUrl = ENV.DATABASE_MIGRATE_URL ?? ENV.DATABASE_URL;
await postgresMigrate({ databaseUrl, migrationsFolder: "./migrations" });
// piece-start: queue
await queueMigrate({ databaseUrl });
// Schedules are synced here and not at Worker boot: migrate runs once per deploy with the newest
// code, so a Worker of the previous version that boots mid-rollout cannot undo them.
await queueSchedulesSync({
	databaseUrl,
	env: ENV,
	schedules: [
		fooSchedule,
		// domain-create: schedules
	],
});
// piece-end: queue
