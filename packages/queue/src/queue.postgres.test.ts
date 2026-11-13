import { setTimeout } from "node:timers/promises";
import { logger } from "@n8io/baseline-logger";
import { ok } from "@n8io/baseline-result";
import pg from "pg";
import {
	afterEach,
	beforeAll,
	describe,
	expect,
	it,
	type MockInstance,
	vi,
} from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Queue,
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
	queueMigrate,
} from "./index.ts";
import { queueBossGet } from "./queue.ts";

let databaseUrl: string;
const pools: pg.Pool[] = [];
const queues: Queue[] = [];

const poolCreate = (): pg.Pool => {
	const pgPool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
	pools.push(pgPool);
	return pgPool;
};

const start = async (
	pgPool: pg.Pool,
	role: "publisher" | "worker",
): Promise<Queue> => {
	const queue = await queueCreate({ pgPool, role });
	queues.push(queue);
	return queue;
};

beforeAll(async () => {
	databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
});

afterEach(async () => {
	vi.restoreAllMocks();
	for (const queue of queues.splice(0)) {
		await queue.stop();
	}
	for (const pgPool of pools.splice(0)) {
		await pgPool.end();
	}
});

describe("queueCreate", () => {
	it("publisher and worker run on the shared pool, with no pool of pg-boss's own", async () => {
		const pgPool = poolCreate();
		await start(pgPool, "publisher");
		await start(pgPool, "worker");

		const own = await pgPool.query(
			"SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND application_name LIKE 'pgboss%'",
		);
		expect(own.rows[0].count).toBe(0);
		expect(pgPool.totalCount).toBeGreaterThan(0);
	});

	it("passes vendor settings to pg-boss, which checks them", async () => {
		await expect(
			queueCreate({
				pgPool: poolCreate(),
				role: "publisher",
				vendor: { monitorIntervalSeconds: 0 },
			}),
		).rejects.toThrow(/monitorIntervalSeconds must be at least/);
	});

	it.each([
		["schema", "queueCreate sets it itself"],
		["supervise", "queueCreate sets it itself"],
		["connectionString", "the queue runs on pgPool; set it on the pool"],
		["ssl", "the queue runs on pgPool; set it on the pool"],
		["createSchema", "it only acts in queueMigrate"],
		["useListenNotify", "the queue does not support it"],
	])("refuses vendor.%s: %s", async (key, reason) => {
		await expect(
			queueCreate({
				pgPool: poolCreate(),
				role: "publisher",
				vendor: { [key]: undefined },
			}),
		).rejects.toThrow(new TypeError(`vendor.${key} is not allowed: ${reason}`));
	});

	it("a publisher starts no workers, maintenance or cron, and runs no SQL while idle", async () => {
		const pgPool = poolCreate();
		const queue = await start(pgPool, "publisher");
		const boss = queueBossGet(queue);
		const query = vi.spyOn(pgPool, "query");

		await setTimeout(3_000);

		expect(boss.getWipData({ includeInternal: true })).toEqual([]);
		expect(boss.isMaintaining()).toBe(false);
		expect(boss.isTimekeeping()).toBe(false);
		expect(query).not.toHaveBeenCalled();
		// The instance registry records the roles pg-boss started with.
		const live = (await boss.getInstances()).filter((row) => row.live);
		expect(live).toEqual([
			expect.objectContaining({
				migrate: false,
				schedule: false,
				supervise: false,
			}),
		]);
	});

	it("a worker starts the cron pass and the inbox prune schedule", async () => {
		const queue = await start(poolCreate(), "worker");
		const boss = queueBossGet(queue);

		const names = boss
			.getWipData({ includeInternal: true })
			.map((wip) => wip.name);
		expect(names).toEqual(
			expect.arrayContaining(["queue.inbox-prune", "__pgboss__send-it"]),
		);
		expect(
			(await boss.getSchedules()).map((schedule) => schedule.name),
		).toEqual(["queue.inbox-prune"]);
	});

	it("every poll stamps the heartbeat, including empty ones", async () => {
		const queue = await start(poolCreate(), "worker");
		const boss = queueBossGet(queue);
		const stamp = (): number =>
			Math.max(...boss.getWipData().map((wip) => wip.lastFetchedOn ?? 0));

		await setTimeout(500);
		const first = stamp();
		await setTimeout(2_500);
		const second = stamp();

		expect(first).toBeGreaterThan(0);
		expect(second).toBeGreaterThan(first);
		expect(queue.isAlive()).toBe(true);
		vi.spyOn(Date, "now").mockReturnValue(second + 60_000);
		expect(queue.isAlive()).toBe(false);
	});

	it("a poll that fails still stamps the heartbeat: an outage is not a stuck loop", async () => {
		const pgPool = poolCreate();
		const queue = await start(pgPool, "worker");
		const boss = queueBossGet(queue);
		const stamp = (key: "lastErrorOn" | "lastFetchedOn"): number =>
			Math.max(...boss.getWipData().map((wip) => wip[key] ?? 0));
		vi.spyOn(logger, "error").mockReturnValue(undefined);
		await setTimeout(500);

		// Postgres goes away: every query fails from here on. A poll already on its way may still land.
		vi.spyOn(pgPool, "query").mockImplementation(() =>
			Promise.reject(new Error("Connection terminated unexpectedly")),
		);
		await setTimeout(500);
		const fetched = stamp("lastFetchedOn");
		await vi.waitFor(
			() => expect(stamp("lastErrorOn")).toBeGreaterThan(fetched + 1_000),
			{ interval: 100, timeout: 15_000 },
		);
		const failed = stamp("lastErrorOn");

		// A minute after the last poll that completed, the failing polls keep it alive.
		expect(stamp("lastFetchedOn")).toBe(fetched);
		vi.spyOn(Date, "now").mockReturnValue(fetched + 60_000);
		expect(queue.isAlive()).toBe(true);
		vi.spyOn(Date, "now").mockReturnValue(failed + 60_000);
		expect(queue.isAlive()).toBe(false);
	});

	it("a poll loop that hangs, with no attempt ending, is reported dead", async () => {
		const pgPool = poolCreate();
		const queue = await start(pgPool, "worker");
		await setTimeout(500);
		expect(queue.isAlive()).toBe(true);

		// Every query hangs, as on a pool with no query timeout whose server went silent.
		const hung: ((error: Error) => void)[] = [];
		vi.spyOn(pgPool, "query").mockImplementation(
			() =>
				new Promise((_resolve, reject) => {
					hung.push(reject);
				}),
		);
		const boss = queueBossGet(queue);
		const stamp = (): number =>
			Math.max(
				...boss
					.getWipData()
					.flatMap((wip) => [wip.lastFetchedOn ?? 0, wip.lastErrorOn ?? 0]),
			);
		// A poll already on its way may still land; after that nothing stamps the heartbeat.
		await setTimeout(500);
		const last = stamp();
		await setTimeout(3_000);
		try {
			expect(stamp()).toBe(last);
			vi.spyOn(Date, "now").mockReturnValue(last + 59_999);
			expect(queue.isAlive()).toBe(true);
			vi.spyOn(Date, "now").mockReturnValue(last + 60_000);
			expect(queue.isAlive()).toBe(false);
		} finally {
			vi.restoreAllMocks();
			vi.spyOn(logger, "error").mockReturnValue(undefined);
			for (const reject of hung) reject(new Error("released"));
		}
	});

	it("logs a failure pg-boss reports as a plain object as an Error, with the object as its cause", async () => {
		const error = vi.spyOn(logger, "error").mockReturnValue(undefined);
		const boss = queueBossGet(await start(poolCreate(), "worker"));
		const reported = {
			code: "ECONNREFUSED",
			message: "connect ECONNREFUSED (Queue: foo.stale-archive, Worker: 1)",
			queue: "foo.stale-archive",
			stack: "Error: connect ECONNREFUSED\n    at somewhere",
			worker: "1",
		};
		const already = new TypeError("already an Error");

		// pg-boss types the event as an Error, and then sends this.
		boss.emit("error", reported as unknown as Error);
		boss.emit("error", already);

		expect(error).toHaveBeenCalledTimes(2);
		expect(error).toHaveBeenNthCalledWith(
			1,
			{ err: expect.any(Error), queue: "foo.stale-archive" },
			"Queue error",
		);
		const logged = error.mock.calls.map(
			(call: unknown[]) => (call[0] as { err: Error }).err,
		);
		expect(logged[0]?.message).toBe(reported.message);
		expect(logged[0]?.stack).toBe(reported.stack);
		expect(logged[0]?.cause).toBe(reported);
		expect(logged[0]).toMatchObject({ code: "ECONNREFUSED" });
		expect(logged[1]).toBe(already);
	});

	it("logs one queue's failures once per 30 s, as an outage fails every poll", async () => {
		const error = vi.spyOn(logger, "error").mockReturnValue(undefined);
		const boss = queueBossGet(await start(poolCreate(), "worker"));
		const failed = (queue: string): Error =>
			Object.assign(new Error("connect ECONNREFUSED"), { queue });
		const now = Date.now();

		boss.emit("error", failed("foo.stale-archive"));
		boss.emit("error", failed("foo.stale-archive"));
		boss.emit("error", failed("foo.report-send"));
		vi.spyOn(Date, "now").mockReturnValue(now + 29_000);
		boss.emit("error", failed("foo.stale-archive"));
		expect(error.mock.calls.map((call: unknown[]) => call[0])).toEqual([
			expect.objectContaining({ queue: "foo.stale-archive" }),
			expect.objectContaining({ queue: "foo.report-send" }),
		]);

		vi.spyOn(Date, "now").mockReturnValue(now + 31_000);
		boss.emit("error", failed("foo.stale-archive"));
		expect(error).toHaveBeenCalledTimes(3);
	});

	it("a worker whose queue was removed stops polling it and says so once", async () => {
		const warn = vi.spyOn(logger, "warn").mockReturnValue(undefined);
		const error = vi.spyOn(logger, "error").mockReturnValue(undefined);
		const queue = await queueCreate({
			pgPool: poolCreate(),
			role: "worker",
			// pg-boss notices a removed queue when it next refreshes its list: every second here.
			vendor: { queueCacheIntervalSeconds: 1 },
		});
		queues.push(queue);
		const boss = queueBossGet(queue);
		await boss.createQueue("search.foo-created");
		await boss.work(
			"search.foo-created",
			{ pollingIntervalSeconds: 0.5 },
			async () => undefined,
		);
		const working = (): string[] => boss.getWipData().map((wip) => wip.name);
		expect(working()).toContain("search.foo-created");

		// What queueMigrate does to a drained queue of an earlier release, from another process.
		const other = await start(poolCreate(), "publisher");
		await queueBossGet(other).deleteQueue("search.foo-created");

		await vi.waitFor(
			() => expect(working()).not.toContain("search.foo-created"),
			{
				interval: 100,
				timeout: 20_000,
			},
		);
		await setTimeout(2_000);
		expect(warn).toHaveBeenCalledExactlyOnceWith(
			{ queue: "search.foo-created" },
			"Queue was removed; this worker stops polling it",
		);
		expect(error).not.toHaveBeenCalled();
	});

	it("refuses a concurrency that is not a positive integer", async () => {
		await expect(
			queueCreate({ concurrency: 0, pgPool: poolCreate(), role: "worker" }),
		).rejects.toThrow(new TypeError("concurrency must be a positive integer"));
	});

	it("a publisher is always alive: it has no workers to poll", async () => {
		const queue = await start(poolCreate(), "publisher");
		vi.spyOn(Date, "now").mockReturnValue(Date.now() + 120_000);

		expect(queue.isAlive()).toBe(true);
	});

	it("stop waits for a running job, then stops the workers and the cron pass", async () => {
		const pgPool = poolCreate();
		const queue = await start(pgPool, "worker");
		const boss = queueBossGet(queue);
		const finished: string[] = [];
		await queueEventsCreate(queue).consumersStart([
			queueConsumerCreate({
				queueName: "bar.foo-created",
				eventName: "foo.created",
				schema: z.object({}),
				run: async () => {
					await setTimeout(1_500);
					finished.push("run");
					return ok(undefined);
				},
			}),
		]);
		await boss.send("bar.foo-created.ordered", {}, { singletonKey: "foo_1" });
		await vi.waitFor(
			async () => {
				const [job] = await boss.findJobs("bar.foo-created.ordered");
				expect(job?.state).toBe("active");
			},
			{ interval: 100, timeout: 10_000 },
		);

		await queue.stop();
		queues.splice(0);

		expect(finished).toEqual(["run"]);
		const [job] = await boss.findJobs("bar.foo-created.ordered");
		expect(job?.state).toBe("completed");
		expect(boss.getWipData({ includeInternal: true })).toEqual([]);
		expect(boss.isTimekeeping()).toBe(false);
		// The pool stays open for the composition root to close.
		await expect(pgPool.query("SELECT 1")).resolves.toBeDefined();
	});

	it("await using stops the queue when its block ends", async () => {
		const pgPool = poolCreate();
		let stop: MockInstance;
		{
			await using queue = await queueCreate({ pgPool, role: "worker" });
			stop = vi.spyOn(queueBossGet(queue), "stop");
		}

		expect(stop).toHaveBeenCalledExactlyOnceWith({
			graceful: true,
			timeout: 15_000,
		});
	});

	it("a job still running at the timeout is failed, to be retried", async () => {
		const queue = await start(poolCreate(), "worker");
		const boss = queueBossGet(queue);
		await queueEventsCreate(queue).consumersStart([
			queueConsumerCreate({
				queueName: "baz.foo-deleted",
				eventName: "foo.deleted",
				schema: z.object({}),
				run: async () => {
					await setTimeout(5_000);
					return ok(undefined);
				},
			}),
		]);
		await boss.send("baz.foo-deleted.ordered", {}, { singletonKey: "foo_1" });
		await vi.waitFor(
			async () => {
				const [job] = await boss.findJobs("baz.foo-deleted.ordered");
				expect(job?.state).toBe("active");
			},
			{ interval: 100, timeout: 10_000 },
		);

		await boss.stop({ graceful: true, timeout: 1_000 });
		queues.splice(0);

		const [job] = await boss.findJobs("baz.foo-deleted.ordered");
		expect(job?.state).toBe("retry");
	});
});
