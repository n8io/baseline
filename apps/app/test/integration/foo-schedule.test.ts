import pg from "pg";
import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";
import { workerSpawn, workerStart } from "./production-server.ts";

const scheduled = async (
	databaseUrl: string,
): Promise<{ name: string; cron: string }[]> => {
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		const { rows } = await pgClient.query<{ name: string; cron: string }>(
			"SELECT name, cron FROM queue.schedule WHERE name NOT LIKE 'queue.%' ORDER BY name",
		);
		return rows;
	} finally {
		await pgClient.end();
	}
};

const workerBoot = (databaseUrl: string, schedule?: string) =>
	workerStart({
		databaseUrl,
		env: schedule === undefined ? {} : { SCHEDULE_FOO_STALE_ARCHIVE: schedule },
	});

describe("worker schedules", { timeout: 60_000 }, () => {
	it("registers foo.stale-archive with its own cron", async () => {
		await using database = await integrationDatabaseCreate();
		await using _worker = await workerBoot(database.databaseUrl);
		expect(await scheduled(database.databaseUrl)).toEqual([
			{ cron: "0 3 * * *", name: "foo.stale-archive" },
		]);
	});

	it("takes the cron from SCHEDULE_FOO_STALE_ARCHIVE", async () => {
		await using database = await integrationDatabaseCreate();
		await using _worker = await workerBoot(database.databaseUrl, "*/5 * * * *");
		expect(await scheduled(database.databaseUrl)).toEqual([
			{ cron: "*/5 * * * *", name: "foo.stale-archive" },
		]);
	});

	it("unschedules foo.stale-archive when SCHEDULE_FOO_STALE_ARCHIVE=off", async () => {
		await using database = await integrationDatabaseCreate();
		const { databaseUrl } = database;
		await using first = await workerBoot(databaseUrl);
		expect(await scheduled(databaseUrl)).toHaveLength(1);
		await first.stop();

		await using _second = await workerBoot(databaseUrl, "off");
		expect(await scheduled(databaseUrl)).toEqual([]);
	});

	it("fails boot naming SCHEDULE_FOO_STALE_ARCHIVE when its cron is bad", async () => {
		await using database = await integrationDatabaseCreate();
		await using worker = await workerSpawn({
			databaseUrl: database.databaseUrl,
			env: { SCHEDULE_FOO_STALE_ARCHIVE: "every day" },
		});
		expect(await worker.exited).toBe(1);
		expect(worker.stderr()).toContain(
			"Invalid cron for SCHEDULE_FOO_STALE_ARCHIVE",
		);
		expect(await scheduled(database.databaseUrl)).toEqual([]);
	});
});
