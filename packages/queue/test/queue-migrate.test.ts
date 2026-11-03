import { ok } from "@n8io/baseline-result";
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
	consumerCreate,
	consumersSubscribe,
	type Queue,
	queueCreate,
	queueMigrate,
	queueStop,
} from "../src/index.ts";
import { queueTestDatabaseCreate } from "./queue-test-database.ts";

let databaseUrl: string;
let pgPool: pg.Pool;
const queues: Queue[] = [];

beforeEach(async () => {
	databaseUrl = await queueTestDatabaseCreate();
	pgPool = new pg.Pool({ connectionString: databaseUrl });
});

afterEach(async () => {
	for (const queue of queues.splice(0)) {
		await queueStop(queue);
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

describe("queueMigrate (V5)", () => {
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
		await consumersSubscribe(queue, [
			consumerCreate("bar.foo-created", "foo.created", z.object({}), async () =>
				ok(undefined),
			),
		]);
		await queueStop(queue);
		queues.splice(0);

		await queueMigrate({ databaseUrl, queuesRemoved: ["bar.foo-created"] });

		const names = await pgPool.query("SELECT name FROM queue.queue");
		const subscriptions = await pgPool.query(
			"SELECT * FROM queue.subscription",
		);
		expect(names.rows).toEqual([]);
		expect(subscriptions.rows).toEqual([]);
	});

	it("rejects a URL that is not Postgres, without echoing it", async () => {
		await expect(
			queueMigrate({ databaseUrl: "memory://secret@host" }),
		).rejects.toThrow(
			'Invalid database URL: found "memory://"; use postgres:// or postgresql://',
		);
	});
});
