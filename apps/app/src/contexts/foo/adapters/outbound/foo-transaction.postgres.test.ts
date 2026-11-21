import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import type { PostgresPool } from "@n8io/baseline-postgres";
import { type Events, queueConsumerCreate } from "@n8io/baseline-queue";
import { err, ok } from "@n8io/baseline-result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "../../../../../test/integration/integration-database.ts";
import { type Connections, connectionsOpen } from "../../../../connections.ts";
import { contextsCreate } from "../../../../contexts.ts";
import { fooCreated, fooDeleted } from "../../domain/foo.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };
let connections: Connections;
let pgPool: PostgresPool;
let drop: () => Promise<void>;

// Jobs pg-boss holds for a subscribed queue: one per event published to it, with its Event key.
const jobsRead = async (
	queueName: string,
): Promise<{ data: unknown; key: string }[]> =>
	(
		await pgPool.query<{ data: unknown; key: string }>(
			"SELECT data, singleton_key AS key FROM queue.job WHERE name = $1 ORDER BY created_on",
			[`${queueName}.ordered`],
		)
	).rows;
const jobsData = async (queueName: string): Promise<unknown[]> =>
	(await jobsRead(queueName)).map((job) => job.data);

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	// A real database makes the queue and Events real too.
	connections = await connectionsOpen({
		role: "publisher",
		urls: { cache: "memory://", database: database.databaseUrl },
	});
	if (connections.database === "memory" || connections.events === "memory") {
		throw new Error("expected a real database");
	}
	pgPool = connections.database;
	// Stand-in Event handlers, so pg-boss copies each event into a queue we can read.
	await connections.events.consumersSubscribe([
		queueConsumerCreate({
			queueName: "baz.foo-created",
			eventName: "foo.created",
			schema: fooCreated,
			run: async () => ok(undefined),
		}),
		queueConsumerCreate({
			queueName: "baz.foo-deleted",
			eventName: "foo.deleted",
			schema: fooDeleted,
			run: async () => ok(undefined),
		}),
	]);
});

afterAll(async () => {
	for (const step of [...connections.intakes, ...connections.resources]) {
		await step.close();
	}
	await drop();
});

describe("foo events on Postgres", () => {
	it("publishes foo.created and foo.deleted when their transactions commit", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		const created = await useCases.fooCreate(owner, { name: "Committed" });
		if (!created.ok) throw created.error;
		expect(await jobsRead("baz.foo-created")).toContainEqual({
			data: { fooId: created.value.id },
			key: created.value.id,
		});

		const deleted = await useCases.fooDelete(owner, {
			fooId: created.value.id,
		});
		expect(deleted.ok).toBe(true);
		expect(await jobsRead("baz.foo-deleted")).toEqual([
			{ data: { fooId: created.value.id }, key: created.value.id },
		]);
	});

	it("publishes foo.deleted once when two deletes race", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		const created = await useCases.fooCreate(owner, { name: "Raced" });
		if (!created.ok) throw created.error;
		const fooId = created.value.id;

		const results = await Promise.all([
			useCases.fooDelete(owner, { fooId }),
			useCases.fooDelete(owner, { fooId }),
		]);

		expect(results.filter((result) => result.ok)).toHaveLength(1);
		expect(
			(await jobsData("baz.foo-deleted")).filter(
				(data) => (data as { fooId: string }).fooId === fooId,
			),
		).toHaveLength(1);
	});

	it("publishes nothing for a taken name, a forbidden delete or an unknown id", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		const created = await useCases.fooCreate(owner, { name: "Taken" });
		if (!created.ok) throw created.error;
		const before = {
			created: await jobsData("baz.foo-created"),
			deleted: await jobsData("baz.foo-deleted"),
		};

		await useCases.fooCreate(owner, { name: "Taken" });
		await useCases.fooDelete(stranger, { fooId: created.value.id });
		await useCases.fooDelete(owner, { fooId: idCreate("foo") });

		expect({
			created: await jobsData("baz.foo-created"),
			deleted: await jobsData("baz.foo-deleted"),
		}).toEqual(before);
	});

	// The transaction is a port with two adapters; its memory twin is in foo-repository.memory.test.ts.
	it("publishes nothing when the transaction rolls back on err or a throw", async () => {
		const fooTransaction = fooTransactionPostgresCreate(
			pgPool,
			connections.events as Events,
		);
		const before = await jobsData("baz.foo-created");
		const fooId = idCreate("foo");

		const rolledBack = await fooTransaction(async ({ fooEvents }) => {
			await fooEvents.publish({
				data: { fooId },
				key: fooId,
				name: "foo.created",
			});
			return err({ type: "Refused" });
		});
		expect(rolledBack.ok).toBe(false);
		await expect(
			fooTransaction(async ({ fooEvents }) => {
				await fooEvents.publish({
					data: { fooId },
					key: fooId,
					name: "foo.created",
				});
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(await jobsData("baz.foo-created")).toEqual(before);
	});
});
