import { setTimeout } from "node:timers/promises";
import { ok } from "@n8io/baseline-result";
import pg from "pg";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
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
import { queueDateNowPin } from "./queue-date-now-pin.ts";
import { queueLoggerTestRecord } from "./queue-logger-test-record.ts";
import type { QueueSql } from "./queue-sql.ts";
import { queueWaitFor } from "./queue-wait-for.ts";

// The tests are the caller here.
const bossGet = (queue: Queue) => queueBossGet(queue, "test");

let databaseUrl: string;
const pools: pg.Pool[] = [];
const queues: Queue[] = [];

const poolCreate = (): pg.Pool => {
	const pgPool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
	pools.push(pgPool);
	return pgPool;
};

// A pool in front of the real one that records every query and, on demand, fails or hangs them
// all, as a Postgres outage or a silent server does.
const poolWrap = (pgPool: pg.Pool) => {
	const state = {
		hung: [] as ((error: Error) => void)[],
		mode: "ok" as "fail" | "hang" | "ok",
		queries: [] as unknown[][],
	};
	const sql: QueueSql = {
		query: (text, values) => {
			state.queries.push([text, values]);
			if (state.mode === "fail") {
				return Promise.reject(new Error("Connection terminated unexpectedly"));
			}
			if (state.mode === "hang") {
				return new Promise((_resolve, reject) => {
					state.hung.push(reject);
				});
			}
			return pgPool.query(text, values as unknown[] | undefined);
		},
	};
	return { sql, state };
};

const start = async (
	pgPool: QueueSql,
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
	for (const queue of queues.splice(0)) {
		await queue.close();
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

	it("a publisher starts no workers, maintenance or cron, and runs no SQL while idle", async () => {
		const { sql, state } = poolWrap(poolCreate());
		const queue = await start(sql, "publisher");
		const boss = bossGet(queue);
		state.queries.length = 0;

		await setTimeout(3_000);

		expect(boss.getWipData({ includeInternal: true })).toEqual([]);
		expect(boss.isMaintaining()).toBe(false);
		expect(boss.isTimekeeping()).toBe(false);
		expect(state.queries).toEqual([]);
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
		const boss = bossGet(queue);

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
		const boss = bossGet(queue);
		const stamp = (): number =>
			Math.max(...boss.getWipData().map((wip) => wip.lastFetchedOn ?? 0));

		await setTimeout(500);
		const first = stamp();
		await setTimeout(2_500);
		const second = stamp();

		expect(first).toBeGreaterThan(0);
		expect(second).toBeGreaterThan(first);
		expect(queue.isAlive()).toBe(true);
		using _clock = queueDateNowPin(second + 60_000);
		expect(queue.isAlive()).toBe(false);
	});

	it("a poll that fails still stamps the heartbeat: an outage is not a stuck loop", async () => {
		const { sql, state } = poolWrap(poolCreate());
		const queue = await start(sql, "worker");
		const boss = bossGet(queue);
		const stamp = (key: "lastErrorOn" | "lastFetchedOn"): number =>
			Math.max(...boss.getWipData().map((wip) => wip[key] ?? 0));
		using _error = queueLoggerTestRecord("error");
		await setTimeout(500);

		// Postgres goes away: every query fails from here on. A poll already on its way may still land.
		state.mode = "fail";
		await setTimeout(500);
		const fetched = stamp("lastFetchedOn");
		await queueWaitFor(
			() => expect(stamp("lastErrorOn")).toBeGreaterThan(fetched + 1_000),
			{ interval: 100, timeout: 15_000 },
		);
		const failed = stamp("lastErrorOn");

		// A minute after the last poll that completed, the failing polls keep it alive.
		expect(stamp("lastFetchedOn")).toBe(fetched);
		using clock = queueDateNowPin(fetched + 60_000);
		expect(queue.isAlive()).toBe(true);
		clock.set(failed + 60_000);
		expect(queue.isAlive()).toBe(false);
		state.mode = "ok";
	});

	it("a poll loop that hangs, with no attempt ending, is reported dead", async () => {
		const { sql, state } = poolWrap(poolCreate());
		const queue = await start(sql, "worker");
		using _error = queueLoggerTestRecord("error");
		await setTimeout(500);
		expect(queue.isAlive()).toBe(true);

		// Every query hangs, as on a pool with no query timeout whose server went silent.
		state.mode = "hang";
		const boss = bossGet(queue);
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
			using clock = queueDateNowPin(last + 59_999);
			expect(queue.isAlive()).toBe(true);
			clock.set(last + 60_000);
			expect(queue.isAlive()).toBe(false);
		} finally {
			state.mode = "ok";
			for (const reject of state.hung) reject(new Error("released"));
		}
	});

	it("logs a failure pg-boss reports as a plain object as an Error, with the object as its cause", async () => {
		using error = queueLoggerTestRecord("error");
		const boss = bossGet(await start(poolCreate(), "worker"));
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

		expect(error.calls).toHaveLength(2);
		expect(error.calls[0]).toEqual([
			{ err: expect.any(Error), queue: "foo.stale-archive" },
			"Queue error",
		]);
		const logged = error.calls.map((call) => (call[0] as { err: Error }).err);
		expect(logged[0]?.message).toBe(reported.message);
		expect(logged[0]?.stack).toBe(reported.stack);
		expect(logged[0]?.cause).toBe(reported);
		expect(logged[0]).toMatchObject({ code: "ECONNREFUSED" });
		expect(logged[1]).toBe(already);
	});

	it("logs one queue's failures once per 30 s, as an outage fails every poll", async () => {
		using error = queueLoggerTestRecord("error");
		const boss = bossGet(await start(poolCreate(), "worker"));
		const failed = (queue: string): Error =>
			Object.assign(new Error("connect ECONNREFUSED"), { queue });
		const now = Date.now();
		using clock = queueDateNowPin(now);

		boss.emit("error", failed("foo.stale-archive"));
		boss.emit("error", failed("foo.stale-archive"));
		boss.emit("error", failed("foo.report-send"));
		clock.set(now + 29_000);
		boss.emit("error", failed("foo.stale-archive"));
		expect(error.calls.map((call) => call[0])).toEqual([
			expect.objectContaining({ queue: "foo.stale-archive" }),
			expect.objectContaining({ queue: "foo.report-send" }),
		]);

		clock.set(now + 31_000);
		boss.emit("error", failed("foo.stale-archive"));
		expect(error.calls).toHaveLength(3);
	});

	it("a worker whose queue was removed stops polling it and says so once", async () => {
		using warn = queueLoggerTestRecord("warn");
		using error = queueLoggerTestRecord("error");
		const queue = await queueCreate({
			pgPool: poolCreate(),
			role: "worker",
			// pg-boss notices a removed queue when it next refreshes its list: every second here.
			vendor: { queueCacheIntervalSeconds: 1 },
		});
		queues.push(queue);
		const boss = bossGet(queue);
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
		await bossGet(other).deleteQueue("search.foo-created");

		await queueWaitFor(
			() => expect(working()).not.toContain("search.foo-created"),
			{
				interval: 100,
				timeout: 20_000,
			},
		);
		await setTimeout(2_000);
		expect(warn.calls).toEqual([
			[
				{ queue: "search.foo-created" },
				"Queue was removed; this worker stops polling it",
			],
		]);
		expect(error.calls).toEqual([]);
	});

	it("a publisher is always alive: it has no workers to poll", async () => {
		const queue = await start(poolCreate(), "publisher");
		using _clock = queueDateNowPin(Date.now() + 120_000);

		expect(queue.isAlive()).toBe(true);
	});

	it("close waits for a running job, then stops the workers and the cron pass", async () => {
		const pgPool = poolCreate();
		const queue = await start(pgPool, "worker");
		const boss = bossGet(queue);
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
		await queueWaitFor(
			async () => {
				const [job] = await boss.findJobs("bar.foo-created.ordered");
				expect(job?.state).toBe("active");
			},
			{ interval: 100, timeout: 10_000 },
		);

		await queue.close();
		queues.splice(0);

		expect(finished).toEqual(["run"]);
		const [job] = await boss.findJobs("bar.foo-created.ordered");
		expect(job?.state).toBe("completed");
		expect(boss.getWipData({ includeInternal: true })).toEqual([]);
		expect(boss.isTimekeeping()).toBe(false);
		// The pool stays open for the entry point to close.
		await expect(pgPool.query("SELECT 1")).resolves.toBeDefined();
	});

	it("await using closes the queue when its block ends", async () => {
		const pgPool = poolCreate();
		const stops: unknown[][] = [];
		{
			await using queue = await queueCreate({ pgPool, role: "worker" });
			const boss = bossGet(queue);
			const stopReal = boss.stop.bind(boss);
			// Records each stop, then runs the real one.
			boss.stop = ((...args: Parameters<typeof boss.stop>) => {
				stops.push(args);
				return stopReal(...args);
			}) as typeof boss.stop;
		}

		expect(stops).toEqual([[{ graceful: true, timeout: 15_000 }]]);
	});

	it("a job still running at the timeout is failed, to be retried", async () => {
		const queue = await start(poolCreate(), "worker");
		const boss = bossGet(queue);
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
		await queueWaitFor(
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
