import {
	postgresPoolCreate,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import { err, ok } from "@n8io/baseline-result";
import type pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Queue,
	queueConsumerCreate,
	queueConsumersSubscribe,
	queueCreate,
	queueEventsMemoryCreate,
	queueEventsPgBossCreate,
	queueMigrate,
} from "./index.ts";

type FooEvents = { "foo.created": { fooId: string } };

let databaseUrl: string;
let pgPool: pg.Pool;
let queue: Queue;
const warnings: Error[] = [];
const onWarning = (warning: Error): void => {
	warnings.push(warning);
};

const jobs = async (): Promise<{ name: string; data: unknown }[]> =>
	(
		await pgPool.query<{ name: string; data: unknown }>(
			"SELECT name, data FROM queue.job WHERE name NOT LIKE '\\_\\_%' ORDER BY name",
		)
	).rows;

beforeAll(async () => {
	databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = postgresPoolCreate({ databaseUrl });
	await pgPool.query("CREATE TABLE foo (id text NOT NULL)");
	queue = await queueCreate({ pgPool, role: "publisher" });
	// Three consumers of one event: pg-boss sends to every queue at once on the one client, and pg
	// warns from the third query queued on a busy client.
	const consumer = (name: string) =>
		queueConsumerCreate(
			name,
			"foo.created",
			z.object({ fooId: z.string() }),
			async () => ok(undefined),
		);
	await queueConsumersSubscribe(queue, [
		consumer("bar.foo-created"),
		consumer("baz.foo-created"),
		consumer("qux.foo-created"),
	]);
	process.on("warning", onWarning);
});

beforeEach(async () => {
	await pgPool.query("TRUNCATE foo");
	await pgPool.query("DELETE FROM queue.job WHERE name NOT LIKE '\\_\\_%'");
	warnings.splice(0);
});

afterAll(async () => {
	process.off("warning", onWarning);
	await queue.stop();
	await pgPool.end();
});

describe("queueEventsPgBossCreate", () => {
	it("publishes on postgresTransactionRun's guarded client, visible only after commit", async () => {
		let seenInside: unknown[] = [];
		const result = await postgresTransactionRun(pgPool, async (pgClient) => {
			await pgClient.query("INSERT INTO foo (id) VALUES ('foo_1')");
			await queueEventsPgBossCreate<FooEvents>(queue, pgClient).publish(
				"foo.created",
				{ fooId: "foo_1" },
			);
			seenInside = await jobs();
			return ok(undefined);
		});

		expect(result).toEqual(ok(undefined));
		expect(seenInside).toEqual([]);
		expect(await jobs()).toEqual([
			{ data: { fooId: "foo_1" }, name: "bar.foo-created" },
			{ data: { fooId: "foo_1" }, name: "baz.foo-created" },
			{ data: { fooId: "foo_1" }, name: "qux.foo-created" },
		]);
		// The sends ran one after the other: pg never saw a second query on a busy client.
		await new Promise((resolve) => setImmediate(resolve));
		expect(warnings.map((warning) => warning.message)).toEqual([]);
	});

	it("rolls the jobs back with the rows on err", async () => {
		const result = await postgresTransactionRun(pgPool, async (pgClient) => {
			await pgClient.query("INSERT INTO foo (id) VALUES ('foo_1')");
			await queueEventsPgBossCreate<FooEvents>(queue, pgClient).publish(
				"foo.created",
				{ fooId: "foo_1" },
			);
			return err({ type: "FooForbidden" });
		});

		expect(result.ok).toBe(false);
		expect(await jobs()).toEqual([]);
		expect((await pgPool.query("SELECT * FROM foo")).rows).toEqual([]);
	});

	it("needs no second pool connection while the transaction holds one", async () => {
		const onePool = postgresPoolCreate({ databaseUrl, max: 1 });
		const oneQueue = await queueCreate({ pgPool: onePool, role: "publisher" });
		try {
			const result = await postgresTransactionRun(onePool, async (pgClient) => {
				await queueEventsPgBossCreate<FooEvents>(oneQueue, pgClient).publish(
					"foo.created",
					{ fooId: "foo_1" },
				);
				return ok(undefined);
			});

			expect(result).toEqual(ok(undefined));
			expect(await jobs()).toHaveLength(3);
		} finally {
			await oneQueue.stop();
			await onePool.end();
		}
	});

	it("rolls the jobs back on a throw", async () => {
		await expect(
			postgresTransactionRun(pgPool, async (pgClient) => {
				await queueEventsPgBossCreate<FooEvents>(queue, pgClient).publish(
					"foo.created",
					{ fooId: "foo_1" },
				);
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(await jobs()).toEqual([]);
	});
});

describe("queueEventsMemoryCreate", () => {
	it("records publishes and delivers nothing", async () => {
		const published: { name: keyof FooEvents; data: unknown }[] = [];
		const events = queueEventsMemoryCreate<FooEvents>(published);

		await events.publish("foo.created", { fooId: "foo_1" });

		expect(published).toEqual([
			{ data: { fooId: "foo_1" }, name: "foo.created" },
		]);
	});

	it("works without an array", async () => {
		await expect(
			queueEventsMemoryCreate<FooEvents>().publish("foo.created", {
				fooId: "foo_1",
			}),
		).resolves.toBeUndefined();
	});
});
