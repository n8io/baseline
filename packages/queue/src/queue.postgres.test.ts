import { setTimeout } from "node:timers/promises";
import { ok } from "@n8io/baseline-result";
import pg from "pg";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Queue,
	queueConsumerCreate,
	queueConsumersStart,
	queueCreate,
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
		await queueConsumersStart(queue, [
			queueConsumerCreate(
				"bar.foo-created",
				"foo.created",
				z.object({}),
				async () => {
					await setTimeout(1_500);
					finished.push("run");
					return ok(undefined);
				},
			),
		]);
		await boss.publish("foo.created", {});
		await vi.waitFor(
			async () => {
				const [job] = await boss.findJobs("bar.foo-created");
				expect(job?.state).toBe("active");
			},
			{ interval: 100, timeout: 10_000 },
		);

		await queue.stop();
		queues.splice(0);

		expect(finished).toEqual(["run"]);
		const [job] = await boss.findJobs("bar.foo-created");
		expect(job?.state).toBe("completed");
		expect(boss.getWipData({ includeInternal: true })).toEqual([]);
		expect(boss.isTimekeeping()).toBe(false);
		// The pool stays open for the composition root to close.
		await expect(pgPool.query("SELECT 1")).resolves.toBeDefined();
	});

	it("a job still running at the timeout is failed, to be retried", async () => {
		const queue = await start(poolCreate(), "worker");
		const boss = queueBossGet(queue);
		await queueConsumersStart(queue, [
			queueConsumerCreate(
				"baz.foo-deleted",
				"foo.deleted",
				z.object({}),
				async () => {
					await setTimeout(5_000);
					return ok(undefined);
				},
			),
		]);
		await boss.publish("foo.deleted", {});
		await vi.waitFor(
			async () => {
				const [job] = await boss.findJobs("baz.foo-deleted");
				expect(job?.state).toBe("active");
			},
			{ interval: 100, timeout: 10_000 },
		);

		await boss.stop({ graceful: true, timeout: 1_000 });
		queues.splice(0);

		const [job] = await boss.findJobs("baz.foo-deleted");
		expect(job?.state).toBe("retry");
	});
});
