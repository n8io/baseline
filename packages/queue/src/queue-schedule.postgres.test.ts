import { ok } from "@n8io/baseline-result";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Queue,
	queueCreate,
	queueMigrate,
	queueScheduleCreate,
	queueSchedulesRegister,
} from "./index.ts";
import { queueBossGet } from "./queue.ts";
import { queueScheduleEnvName } from "./queue-schedule.ts";

let pgPool: pg.Pool;
const queues: Queue[] = [];

const schedule = (name: string, cron = "0 3 * * *") =>
	queueScheduleCreate({ name, cron, run: async () => ok(undefined) });

const worker = async (): Promise<Queue> => {
	const queue = await queueCreate({ pgPool, role: "worker" });
	queues.push(queue);
	return queue;
};

const held = async (queue: Queue): Promise<Record<string, string>> =>
	Object.fromEntries(
		(await queueBossGet(queue).getSchedules()).map((row) => [
			row.name,
			row.cron,
		]),
	);

beforeEach(async () => {
	for (const queue of queues.splice(0)) {
		await queue.stop();
	}
	await pgPool?.end();
	const databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = new pg.Pool({ connectionString: databaseUrl });
});

afterAll(async () => {
	for (const queue of queues.splice(0)) {
		await queue.stop();
	}
	await pgPool.end();
});

describe("queueSchedulesRegister", () => {
	it("registers each schedule on an exclusive queue with a dead letter, and starts its worker", async () => {
		const queue = await worker();
		await queueSchedulesRegister({
			queue,
			schedules: [schedule("foo.stale-archive")],
			env: {},
		});

		expect(await held(queue)).toEqual({
			"foo.stale-archive": "0 3 * * *",
			"queue.inbox-prune": "0 4 * * *",
		});
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
		expect(
			queueBossGet(queue)
				.getWipData()
				.map((wip) => wip.name),
		).toContain("foo.stale-archive");
	});

	it("unschedules what is no longer in code, and keeps the package's own", async () => {
		const queue = await worker();
		await queueSchedulesRegister({
			queue,
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
			env: {},
		});

		await queueSchedulesRegister({
			queue,
			schedules: [schedule("foo.stale-archive")],
			env: {},
		});

		expect(await held(queue)).toEqual({
			"foo.stale-archive": "0 3 * * *",
			"queue.inbox-prune": "0 4 * * *",
		});
	});

	it("during a rollout, the version that registered last decides", async () => {
		const old = await worker();
		const next = await worker();

		await queueSchedulesRegister({
			queue: old,
			schedules: [schedule("foo.report-send")],
			env: {},
		});
		await queueSchedulesRegister({
			queue: next,
			schedules: [schedule("foo.stale-archive")],
			env: {},
		});
		expect(Object.keys(await held(next)).sort()).toEqual([
			"foo.stale-archive",
			"queue.inbox-prune",
		]);

		// An old instance that restarts mid-rollout puts its own list back until a new one boots.
		await queueSchedulesRegister({
			queue: old,
			schedules: [schedule("foo.report-send")],
			env: {},
		});
		expect(Object.keys(await held(next)).sort()).toEqual([
			"foo.report-send",
			"queue.inbox-prune",
		]);
	});

	it("applies a cron override, and off unschedules", async () => {
		const queue = await worker();
		await queueSchedulesRegister({
			queue,
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
			env: {},
		});

		await queueSchedulesRegister({
			queue,
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
			env: {
				SCHEDULE_FOO_REPORT_SEND: "off",
				SCHEDULE_FOO_STALE_ARCHIVE: "*/5 * * * *",
			},
		});

		expect(await held(queue)).toEqual({
			"foo.stale-archive": "*/5 * * * *",
			"queue.inbox-prune": "0 4 * * *",
		});
	});

	it("reads overrides from a typed ENV proxy, and ignores items that are not strings", async () => {
		const queue = await worker();
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
		await queueSchedulesRegister({
			queue,
			schedules: [schedule("foo.stale-archive"), schedule("foo.report-send")],
			env,
		});

		expect(await held(queue)).toEqual({
			"foo.report-send": "0 3 * * *",
			"foo.stale-archive": "*/5 * * * *",
			"queue.inbox-prune": "0 4 * * *",
		});
	});

	it("throws on a bad override, naming the variable, before registering anything", async () => {
		const queue = await worker();

		await expect(
			queueSchedulesRegister({
				queue,
				schedules: [schedule("foo.report-send"), schedule("foo.stale-archive")],
				env: { SCHEDULE_FOO_STALE_ARCHIVE: "every day" },
			}),
		).rejects.toThrow(
			"Invalid cron for SCHEDULE_FOO_STALE_ARCHIVE: use a cron string or off",
		);
		expect(await held(queue)).toEqual({ "queue.inbox-prune": "0 4 * * *" });
	});

	it("throws on a bad cron in code, naming the schedule", async () => {
		const queue = await worker();

		await expect(
			queueSchedulesRegister({
				queue,
				schedules: [schedule("foo.stale-archive", "61 * * * *")],
				env: {},
			}),
		).rejects.toThrow("Invalid cron for schedule foo.stale-archive");
	});
});

describe("queueScheduleEnvName", () => {
	it("uppercases the name and turns . and - into _", () => {
		expect(queueScheduleEnvName("foo.stale-archive")).toBe(
			"SCHEDULE_FOO_STALE_ARCHIVE",
		);
	});
});
