import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { workerStart } from "./production-server.ts";

const execFileAsync = promisify(execFile);

const query = async <Row extends pg.QueryResultRow>(
	databaseUrl: string,
	text: string,
): Promise<Row[]> => {
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		return (await pgClient.query<Row>(text)).rows;
	} finally {
		await pgClient.end();
	}
};

const scheduled = (databaseUrl: string) =>
	query<{ name: string; cron: string }>(
		databaseUrl,
		"SELECT name, cron FROM queue.schedule WHERE name NOT LIKE 'queue.%' ORDER BY name",
	);

const scheduleEnv = (schedule?: string): Record<string, string> =>
	schedule === undefined ? {} : { SCHEDULE_FOO_STALE_ARCHIVE: schedule };

// Runs src/migrate.ts the way a deploy does, here against a database that is already migrated.
const migrateRun = (databaseUrl: string, schedule?: string) =>
	execFileAsync("node", ["--import", "varlock/auto-load", "src/migrate.ts"], {
		env: {
			...process.env,
			// The Vitest worker's serialized varlock env would win over every override below.
			__VARLOCK_ENV: undefined,
			APP_ENV: "test",
			DATABASE_URL: databaseUrl,
			...scheduleEnv(schedule),
		},
	});

describe("schedules", { timeout: 60_000 }, () => {
	it("migrate syncs foo.stale-archive with its own cron", async () => {
		await using database = await integrationDatabaseCreate();
		await query(database.databaseUrl, "DELETE FROM queue.schedule");

		await migrateRun(database.databaseUrl);

		expect(await scheduled(database.databaseUrl)).toEqual([
			{ cron: "0 3 * * *", name: "foo.stale-archive" },
		]);
	});

	it("migrate takes the cron from SCHEDULE_FOO_STALE_ARCHIVE", async () => {
		await using database = await integrationDatabaseCreate();

		await migrateRun(database.databaseUrl, "*/5 * * * *");

		expect(await scheduled(database.databaseUrl)).toEqual([
			{ cron: "*/5 * * * *", name: "foo.stale-archive" },
		]);
	});

	it("migrate removes foo.stale-archive when SCHEDULE_FOO_STALE_ARCHIVE=off", async () => {
		await using database = await integrationDatabaseCreate();
		expect(await scheduled(database.databaseUrl)).toHaveLength(1);

		await migrateRun(database.databaseUrl, "off");

		expect(await scheduled(database.databaseUrl)).toEqual([]);
	});

	it("migrate fails naming SCHEDULE_FOO_STALE_ARCHIVE when its cron is bad, and changes nothing", async () => {
		await using database = await integrationDatabaseCreate();

		await expect(
			migrateRun(database.databaseUrl, "every day"),
		).rejects.toMatchObject({
			code: 1,
			stderr: expect.stringContaining(
				"Invalid cron for SCHEDULE_FOO_STALE_ARCHIVE",
			),
		});
		expect(await scheduled(database.databaseUrl)).toEqual([
			{ cron: "0 3 * * *", name: "foo.stale-archive" },
		]);
	});

	it("a Worker boot changes no Schedule, whatever its own env says", async () => {
		await using database = await integrationDatabaseCreate();

		// A Worker of another version mid-rollout: here, one that has the Schedule turned off.
		await using _worker = await workerStart({
			databaseUrl: database.databaseUrl,
			env: scheduleEnv("off"),
		});

		expect(await scheduled(database.databaseUrl)).toEqual([
			{ cron: "0 3 * * *", name: "foo.stale-archive" },
		]);
	});

	it("a Worker warns about a Schedule migrate has not synced, and still boots", async () => {
		await using database = await integrationDatabaseCreate();
		await query(database.databaseUrl, "DELETE FROM queue.schedule");

		await using worker = await workerStart({
			databaseUrl: database.databaseUrl,
			env: { LOG_LEVEL: "warn" },
		});

		expect(worker.stdout()).toContain(
			"Schedule is not in the database, so it will not run: run migrate",
		);
		expect(worker.stdout()).toContain("foo.stale-archive");
		expect(await scheduled(database.databaseUrl)).toEqual([]);
	});
});
