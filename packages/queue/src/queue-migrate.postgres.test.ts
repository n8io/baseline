import { ok } from "@n8io/baseline-result";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
let pgPool: pg.Pool;
const queues: Queue[] = [];

beforeEach(async () => {
	databaseUrl = await postgresTestDatabaseCreate();
	pgPool = new pg.Pool({ connectionString: databaseUrl });
});

afterEach(async () => {
	for (const queue of queues.splice(0)) {
		await queue.stop();
	}
	await pgPool.end();
});

const start = async (): Promise<Queue> => {
	const queue = await queueCreate({ pgPool, role: "publisher" });
	queues.push(queue);
	return queue;
};

const tables = async (schema: string): Promise<string[]> =>
	(
		await pgPool.query<{ table_name: string }>(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name",
			[schema],
		)
	).rows.map((row) => row.table_name);

describe("queueMigrate", () => {
	it("installs pg-boss and queue.inbox in schema queue, then start() with migrate: false succeeds", async () => {
		await queueMigrate({ databaseUrl });

		expect(await tables("queue")).toEqual(
			expect.arrayContaining(["inbox", "job", "queue", "schedule", "version"]),
		);
		expect(await tables("public")).toEqual([]);
		await expect(start()).resolves.toBeDefined();
	});

	it("is safe to run again", async () => {
		await queueMigrate({ databaseUrl });
		await expect(queueMigrate({ databaseUrl })).resolves.toBeUndefined();
	});

	it("start() with migrate: false throws when pg-boss is not installed", async () => {
		await expect(start()).rejects.toThrow("pg-boss is not installed");
	});

	it("start() with migrate: false throws when a migration is pending", async () => {
		await queueMigrate({ databaseUrl });
		await pgPool.query("UPDATE queue.version SET version = version - 1");

		await expect(start()).rejects.toThrow(
			"pg-boss database requires migrations",
		);
	});

	it("deletes the queues of removed consumers, with their dead letters and subscriptions", async () => {
		await queueMigrate({ databaseUrl });
		const queue = await start();
		await queueEventsCreate(queue).consumersSubscribe([
			queueConsumerCreate({
				queueName: "bar.foo-created",
				eventName: "foo.created",
				schema: z.object({}),
				run: async () => ok(undefined),
			}),
		]);
		await queue.stop();
		queues.splice(0);

		await queueMigrate({ databaseUrl, queuesRemoved: ["bar.foo-created"] });

		const names = await pgPool.query("SELECT name FROM queue.queue");
		const subscriptions = await pgPool.query(
			"SELECT * FROM queue.subscription",
		);
		expect(names.rows).toEqual([]);
		expect(subscriptions.rows).toEqual([]);
	});

	it("moves a Consumer off the unordered queue of an earlier release with jobs in flight, losing nothing", async () => {
		await queueMigrate({ databaseUrl });
		const handled: string[] = [];
		const consumer = queueConsumerCreate({
			queueName: "bar.foo-created",
			eventName: "foo.created",
			schema: z.object({ fooId: z.string() }),
			run: async (event) => {
				handled.push(event.fooId);
				return ok(undefined);
			},
		});
		// The earlier release: an unordered queue subscribed to the Event, three jobs without a key,
		// one of them taken by a worker that failed it, so it waits for its retry.
		const old = queueBossGet(await start());
		await old.createQueue("bar.foo-created.dead");
		await old.createQueue("bar.foo-created", {
			deadLetter: "bar.foo-created.dead",
			retryDelay: 1,
			retryLimit: 4,
		});
		await old.subscribe("foo.created", "bar.foo-created");
		for (const fooId of ["foo_1", "foo_2", "foo_3"]) {
			await old.publish("foo.created", { fooId });
		}
		const [taken] = await old.fetch("bar.foo-created");
		await old.fail("bar.foo-created", taken?.id ?? "");

		// The rollout: migrate, then a worker of this release.
		await queueMigrate({ databaseUrl });
		const worker = await queueCreate({ pgPool, role: "worker" });
		const events = queueEventsCreate(worker);
		await events.consumersStart([consumer]);
		const publish = async (fooId: string): Promise<void> => {
			const pgClient = await pgPool.connect();
			try {
				await events
					.publisherCreate<{ "foo.created": { fooId: string } }>(pgClient)
					.publish({ data: { fooId }, key: fooId, name: "foo.created" });
			} finally {
				pgClient.release();
			}
		};
		await publish("foo_4");
		// The retried job is due after the worker's first fetches, so it waits for the next slow poll.
		await expect
			.poll(() => [...handled].sort(), { interval: 250, timeout: 45_000 })
			.toEqual(["foo_1", "foo_2", "foo_3", "foo_4"]);
		// A process of the earlier release is still publishing, to the queue it knows.
		await old.publish("foo.created", { fooId: "foo_5" });
		await expect
			.poll(() => handled, { interval: 250, timeout: 45_000 })
			.toContain("foo_5");
		await worker.stop();

		// The next rollout, the same day: the unordered queue is kept, in case that release still runs.
		await queueMigrate({ databaseUrl });
		expect(await old.getQueue("bar.foo-created")).not.toBeNull();

		// A rollout after a quiet day removes it and its subscription; the ordered queue carries on.
		await pgPool.query(
			"UPDATE queue.job SET created_on = created_on - interval '2 days' WHERE name = 'bar.foo-created'",
		);
		await queueMigrate({ databaseUrl });
		const names = await pgPool.query(
			"SELECT name FROM queue.queue WHERE name LIKE 'bar.%' ORDER BY name",
		);
		expect(names.rows.map((row) => row.name)).toEqual([
			"bar.foo-created.dead",
			"bar.foo-created.ordered",
		]);
		const subscriptions = await pgPool.query(
			"SELECT event, name FROM queue.subscription",
		);
		expect(subscriptions.rows).toEqual([
			{ event: "foo.created.ordered", name: "bar.foo-created.ordered" },
		]);
		expect(handled).toHaveLength(5);
	}, 120_000);

	it("keeps an unordered queue that still has a job waiting", async () => {
		await queueMigrate({ databaseUrl });
		const queue = await start();
		const boss = queueBossGet(queue);
		await boss.createQueue("bar.foo-created");
		await boss.send("bar.foo-created", { fooId: "foo_1" });
		await queueEventsCreate(queue).consumersSubscribe([
			queueConsumerCreate({
				queueName: "bar.foo-created",
				eventName: "foo.created",
				schema: z.object({}),
				run: async () => ok(undefined),
			}),
		]);
		await pgPool.query(
			"UPDATE queue.job SET created_on = created_on - interval '2 days'",
		);

		await queueMigrate({ databaseUrl });

		expect(await boss.getQueue("bar.foo-created")).not.toBeNull();
	});

	it("rejects a URL that is not Postgres, without echoing it", async () => {
		await expect(
			queueMigrate({ databaseUrl: "memory://secret@host" }),
		).rejects.toThrow(
			'Invalid database URL: found "memory://"; use postgres:// or postgresql://',
		);
	});
});
