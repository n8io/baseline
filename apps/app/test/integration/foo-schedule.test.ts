import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
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

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const databaseCreate = async (): Promise<string> => {
	const { databaseUrl, drop } = await integrationDatabaseCreate();
	cleanups.push(drop);
	return databaseUrl;
};

const workerBoot = async (databaseUrl: string, schedule?: string) => {
	const worker = await workerStart({
		cacheUrl: "memory://",
		databaseUrl,
		env: schedule === undefined ? {} : { SCHEDULE_FOO_STALE_ARCHIVE: schedule },
	});
	cleanups.push(worker.stop);
	return worker;
};

describe("worker schedules", { timeout: 30_000 }, () => {
	it("registers foo.stale-archive with its own cron", async () => {
		const databaseUrl = await databaseCreate();
		await workerBoot(databaseUrl);
		expect(await scheduled(databaseUrl)).toEqual([
			{ cron: "0 3 * * *", name: "foo.stale-archive" },
		]);
	});

	it("takes the cron from SCHEDULE_FOO_STALE_ARCHIVE", async () => {
		const databaseUrl = await databaseCreate();
		await workerBoot(databaseUrl, "*/5 * * * *");
		expect(await scheduled(databaseUrl)).toEqual([
			{ cron: "*/5 * * * *", name: "foo.stale-archive" },
		]);
	});

	it("unschedules foo.stale-archive when SCHEDULE_FOO_STALE_ARCHIVE=off", async () => {
		const databaseUrl = await databaseCreate();
		const first = await workerBoot(databaseUrl);
		expect(await scheduled(databaseUrl)).toHaveLength(1);
		await first.stop();

		await workerBoot(databaseUrl, "off");
		expect(await scheduled(databaseUrl)).toEqual([]);
	});

	it("fails boot naming SCHEDULE_FOO_STALE_ARCHIVE when its cron is bad", async () => {
		const databaseUrl = await databaseCreate();
		const worker = await workerSpawn({
			cacheUrl: "memory://",
			databaseUrl,
			env: { SCHEDULE_FOO_STALE_ARCHIVE: "every day" },
		});
		cleanups.push(worker.stop);
		expect(await worker.exited).toBe(1);
		expect(worker.stderr()).toContain(
			"Invalid cron for SCHEDULE_FOO_STALE_ARCHIVE",
		);
		expect(await scheduled(databaseUrl)).toEqual([]);
	});
});
