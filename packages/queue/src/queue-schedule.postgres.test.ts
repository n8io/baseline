import { logger } from "@n8io/baseline-logger";
import { ok } from "@n8io/baseline-result";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Queue,
	queueCreate,
	queueMigrate,
	queueScheduleCreate,
	queueSchedulesStart,
	queueSchedulesSync,
} from "./index.ts";
import { queueBossGet } from "./queue.ts";
import { queueScheduleEnvName } from "./queue-schedule.ts";

let databaseUrl: string;
let pgPool: pg.Pool;
const queues: Queue[] = [];

const schedule = (name: string, cron = "0 3 * * *") =>
	queueScheduleCreate({ name, cron, run: async () => ok(undefined) });

const worker = async (): Promise<Queue> => {
	const queue = await queueCreate({ pgPool, role: "worker" });
	queues.push(queue);
	return queue;
};

// The Schedules the database holds, by name, as the cron of each.
const held = async (): Promise<Record<string, string>> => {
	const { rows } = await pgPool.query<{ name: string; cron: string }>(
		"SELECT name, cron FROM queue.schedule",
	);
	return Object.fromEntries(rows.map((row) => [row.name, row.cron]));
};

const working = (queue: Queue): string[] =>
	queueBossGet(queue)
		.getWipData()
		.map((wip) => wip.name);

beforeEach(async () => {
	for (const queue of queues.splice(0)) {
		await queue.stop();
	}
	await pgPool?.end();
	vi.restoreAllMocks();
	databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = new pg.Pool({ connectionString: databaseUrl });
});

afterAll(async () => {
	for (const queue of queues.splice(0)) {
		await queue.stop();
	}
	await pgPool.end();
});

describe("queueSchedulesSync", () => {
	it("adds each schedule on an exclusive queue with a dead letter", async () => {
		await queueSchedulesSync({
			databaseUrl,
			env: {},
			schedules: [schedule("foo.stale-archive")],
		});

		expect(await held()).toEqual({ "foo.stale-archive": "0 3 * * *" });
		const queue = await worker();
		const [row] = await queueBossGet(queue).getSchedules("foo.stale-archive");
		expect(row?.options).toMatchObject({ missed: "once", tz: "UTC" });
		expect(
			await queueBossGet(queue).getQueue("foo.stale-archive"),
		).toMatchObject({
			deadLetter: "foo.stale-archive.dead",
			policy: "exclusive",
			retryBackoff: true,
			retryDelay: 10,
			retryLimit: 4,
		});
	});

	it("needs only a name and a cron", async () => {
		await queueSchedulesSync({
			databaseUrl,
			env: {},
			schedules: [{ cron: "0 3 * * *", name: "foo.stale-archive" }],
		});

		expect(await held()).toEqual({ "foo.stale-archive": "0 3 * * *" });
	});

	it("removes what is no longer in code, updates a changed cron, and keeps the package's own", async () => {
		await worker();
		await queueSchedulesSync({
			databaseUrl,
			env: {},
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
		});

		await queueSchedulesSync({
			databaseUrl,
			env: {},
			schedules: [schedule("foo.stale-archive", "0 5 * * *")],
		});

		expect(await held()).toEqual({
			"foo.stale-archive": "0 5 * * *",
			"queue.inbox-prune": "0 4 * * *",
		});
	});

	it("applies a cron override, and off removes", async () => {
		await queueSchedulesSync({
			databaseUrl,
			env: {},
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
		});

		await queueSchedulesSync({
			databaseUrl,
			env: {
				SCHEDULE_FOO_REPORT_SEND: "off",
				SCHEDULE_FOO_STALE_ARCHIVE: "*/5 * * * *",
			},
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
		});

		expect(await held()).toEqual({ "foo.stale-archive": "*/5 * * * *" });
	});

	it("reads overrides from a typed ENV proxy, and ignores items that are not strings", async () => {
		// Like varlock's ENV: no own keys, values only through the get trap, typed items.
		const env = new Proxy(
			{},
			{
				get: (_target, name) =>
					({
						SCHEDULE_FOO_REPORT_SEND: 5,
						SCHEDULE_FOO_STALE_ARCHIVE: "*/5 * * * *",
					})[String(name)],
			},
		);
		await queueSchedulesSync({
			databaseUrl,
			env,
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
		});

		expect(await held()).toEqual({
			"foo.report-send": "0 3 * * *",
			"foo.stale-archive": "*/5 * * * *",
		});
	});

	it("throws on a bad override, naming the variable, before changing anything", async () => {
		await expect(
			queueSchedulesSync({
				databaseUrl,
				env: { SCHEDULE_FOO_STALE_ARCHIVE: "every day" },
				schedules: [schedule("foo.report-send"), schedule("foo.stale-archive")],
			}),
		).rejects.toThrow(
			"Invalid cron for SCHEDULE_FOO_STALE_ARCHIVE: use a cron string or off",
		);
		expect(await held()).toEqual({});
	});

	it("throws on a bad cron in code, naming the schedule", async () => {
		await expect(
			queueSchedulesSync({
				databaseUrl,
				env: {},
				schedules: [schedule("foo.stale-archive", "61 * * * *")],
			}),
		).rejects.toThrow("Invalid cron for schedule foo.stale-archive");
	});

	it("refuses a URL that is not Postgres", async () => {
		await expect(
			queueSchedulesSync({ databaseUrl: "memory://", env: {}, schedules: [] }),
		).rejects.toThrow("Invalid database URL");
	});
});

describe("queueSchedulesStart", () => {
	it("starts a worker for each schedule the database holds", async () => {
		await queueSchedulesSync({
			databaseUrl,
			env: {},
			schedules: [schedule("foo.stale-archive")],
		});
		const queue = await worker();

		await queueSchedulesStart({
			env: {},
			queue,
			schedules: [schedule("foo.stale-archive")],
		});

		expect(working(queue)).toContain("foo.stale-archive");
	});

	it("during a rollout, a worker that does not declare a schedule leaves it in place", async () => {
		await queueSchedulesSync({
			databaseUrl,
			env: {},
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
		});
		const old = await worker();

		// The previous version boots late: it knows one Schedule less, another cron, and has one off.
		await queueSchedulesStart({
			env: { SCHEDULE_FOO_STALE_ARCHIVE: "off" },
			queue: old,
			schedules: [schedule("foo.stale-archive", "0 9 * * *")],
		});

		expect(await held()).toEqual({
			"foo.report-send": "0 3 * * *",
			"foo.stale-archive": "0 3 * * *",
			"queue.inbox-prune": "0 4 * * *",
		});
		expect(working(old)).not.toContain("foo.stale-archive");
	});

	it("warns about a schedule the database does not hold, and does not start it", async () => {
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const queue = await worker();

		await queueSchedulesStart({
			env: {},
			queue,
			schedules: [schedule("foo.stale-archive")],
		});

		expect(warn).toHaveBeenCalledExactlyOnceWith(
			{ schedule: "foo.stale-archive" },
			"Schedule is not in the database, so it will not run: run migrate",
		);
		expect(working(queue)).not.toContain("foo.stale-archive");
		expect(await held()).toEqual({ "queue.inbox-prune": "0 4 * * *" });
	});

	it("skips a schedule that is turned off, without a warning", async () => {
		const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);
		const queue = await worker();

		await queueSchedulesStart({
			env: { SCHEDULE_FOO_STALE_ARCHIVE: "off" },
			queue,
			schedules: [schedule("foo.stale-archive")],
		});

		expect(warn).not.toHaveBeenCalled();
		expect(working(queue)).not.toContain("foo.stale-archive");
	});
});

describe("queueScheduleEnvName", () => {
	it("uppercases the name and turns . and - into _", () => {
		expect(queueScheduleEnvName("foo.stale-archive")).toBe(
			"SCHEDULE_FOO_STALE_ARCHIVE",
		);
	});
});
