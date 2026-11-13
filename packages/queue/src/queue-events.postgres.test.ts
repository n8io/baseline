import {
	type PostgresPool,
	postgresPoolCreate,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import { err, ok } from "@n8io/baseline-result";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type Queue,
	queueConsumerCreate,
	queueCreate,
	queueEventsCreate,
	queueEventsMemoryCreate,
	queueMigrate,
} from "./index.ts";

type FooEvents = { "foo.created": { fooId: string } };

let databaseUrl: string;
let pgPool: PostgresPool;
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
		queueConsumerCreate({
			queueName: name,
			eventName: "foo.created",
			schema: z.object({ fooId: z.string() }),
			run: async () => ok(undefined),
		});
	await queueEventsCreate(queue).consumersSubscribe([
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

describe("queueEventsCreate", () => {
	it("publishes on postgresTransactionRun's guarded client, visible only after commit", async () => {
		let seenInside: unknown[] = [];
		const result = await postgresTransactionRun({
			pgPool,
			work: async (pgClient) => {
				await pgClient.query("INSERT INTO foo (id) VALUES ('foo_1')");
				await queueEventsCreate(queue)
					.publisherCreate<FooEvents>(pgClient)
					.publish({
						data: { fooId: "foo_1" },
						key: "foo_1",
						name: "foo.created",
					});
				seenInside = await jobs();
				return ok(undefined);
			},
		});

		expect(result).toEqual(ok(undefined));
		expect(seenInside).toEqual([]);
		expect(await jobs()).toEqual([
			{ data: { fooId: "foo_1" }, name: "bar.foo-created.ordered" },
			{ data: { fooId: "foo_1" }, name: "baz.foo-created.ordered" },
			{ data: { fooId: "foo_1" }, name: "qux.foo-created.ordered" },
		]);
		// The sends ran one after the other: pg never saw a second query on a busy client.
		await new Promise((resolve) => setImmediate(resolve));
		expect(warnings.map((warning) => warning.message)).toEqual([]);
	});

	it("rolls the jobs back with the rows on err", async () => {
		const result = await postgresTransactionRun({
			pgPool,
			work: async (pgClient) => {
				await pgClient.query("INSERT INTO foo (id) VALUES ('foo_1')");
				await queueEventsCreate(queue)
					.publisherCreate<FooEvents>(pgClient)
					.publish({
						data: { fooId: "foo_1" },
						key: "foo_1",
						name: "foo.created",
					});
				return err({ type: "FooForbidden" });
			},
		});

		expect(result.ok).toBe(false);
		expect(await jobs()).toEqual([]);
		expect((await pgPool.query("SELECT * FROM foo")).rows).toEqual([]);
	});

	it("needs no second pool connection while the transaction holds one", async () => {
		await using onePool = postgresPoolCreate({ databaseUrl, max: 1 });
		await using oneQueue = await queueCreate({
			pgPool: onePool,
			role: "publisher",
		});
		const result = await postgresTransactionRun({
			pgPool: onePool,
			work: async (pgClient) => {
				await queueEventsCreate(oneQueue)
					.publisherCreate<FooEvents>(pgClient)
					.publish({
						data: { fooId: "foo_1" },
						key: "foo_1",
						name: "foo.created",
					});
				return ok(undefined);
			},
		});

		expect(result).toEqual(ok(undefined));
		expect(await jobs()).toHaveLength(3);
	});

	it("rolls the jobs back on a throw", async () => {
		await expect(
			postgresTransactionRun({
				pgPool,
				work: async (pgClient) => {
					await queueEventsCreate(queue)
						.publisherCreate<FooEvents>(pgClient)
						.publish({
							data: { fooId: "foo_1" },
							key: "foo_1",
							name: "foo.created",
						});
					throw new Error("boom");
				},
			}),
		).rejects.toThrow("boom");
		expect(await jobs()).toEqual([]);
	});
});

describe("queueEventsMemoryCreate", () => {
	it("records publishes and delivers nothing", async () => {
		const published: {
			name: keyof FooEvents;
			data: unknown;
			key: string;
		}[] = [];
		const events = queueEventsMemoryCreate<FooEvents>({ published });

		await events.publish({
			data: { fooId: "foo_1" },
			key: "foo_1",
			name: "foo.created",
		});

		expect(published).toEqual([
			{ data: { fooId: "foo_1" }, key: "foo_1", name: "foo.created" },
		]);
	});

	it("works without options", async () => {
		await expect(
			queueEventsMemoryCreate<FooEvents>().publish({
				data: { fooId: "foo_1" },
				key: "foo_1",
				name: "foo.created",
			}),
		).resolves.toBeUndefined();
	});
});
