import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import {
	type Queue,
	queueConsumerCreate,
	queueConsumersSubscribe,
	queueCreate,
} from "@n8io/baseline-queue";
import { err, ok } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "../../../../test/integration/integration-database.ts";
import { fooCreated, fooDeleted } from "../models/foo.ts";
import { fooUseCasesCreate } from "../use-cases/foo-use-cases.ts";
import { fooPortsMemoryCreate } from "./foo-ports.memory.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

const actor: Actor = { id: "owner", kind: "client", scopes: [] };
let pgPool: pg.Pool;
let queue: Queue;
let drop: () => Promise<void>;

// Jobs pg-boss holds for a subscribed queue: one per event published to it.
const jobsData = async (queueName: string): Promise<unknown[]> =>
	(
		await pgPool.query<{ data: unknown }>(
			"SELECT data FROM queue.job WHERE name = $1 ORDER BY created_on",
			[queueName],
		)
	).rows.map((row) => row.data);

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	pgPool = postgresPoolCreate({ databaseUrl: database.databaseUrl, max: 4 });
	queue = await queueCreate({ pgPool, role: "publisher" });
	// Stand-in consumers, so pg-boss copies each event into a queue we can read.
	await queueConsumersSubscribe(queue, [
		queueConsumerCreate(
			"bar.foo-created",
			"foo.created",
			fooCreated,
			async () => ok(undefined),
		),
		queueConsumerCreate(
			"bar.foo-deleted",
			"foo.deleted",
			fooDeleted,
			async () => ok(undefined),
		),
	]);
});

afterAll(async () => {
	await queue.stop();
	await pgPool.end();
	await drop();
});

describe("foo events on Postgres", () => {
	const ports = () => ({
		...fooPortsMemoryCreate().ports,
		fooReadRepository: fooRepositoryPostgresCreate(drizzle({ client: pgPool })),
		fooTransaction: fooTransactionPostgresCreate(pgPool, queue),
	});

	it("publishes foo.created and foo.deleted when their transactions commit", async () => {
		const u = fooUseCasesCreate(ports());
		const created = await u.fooCreate(actor, { name: "Committed" });
		if (!created.ok) throw created.error;
		expect(await jobsData("bar.foo-created")).toContainEqual({
			fooId: created.value.id,
		});

		const deleted = await u.fooDelete(actor, { fooId: created.value.id });
		expect(deleted.ok).toBe(true);
		expect(await jobsData("bar.foo-deleted")).toEqual([
			{ fooId: created.value.id },
		]);
	});

	it("publishes nothing when the transaction rolls back on err or a throw", async () => {
		const { fooTransaction } = ports();
		const before = await jobsData("bar.foo-created");
		const fooId = idCreate("foo");

		const rolledBack = await fooTransaction(async ({ fooEvents }) => {
			await fooEvents.publish("foo.created", { fooId });
			return err({ type: "Refused" });
		});
		expect(rolledBack.ok).toBe(false);
		await expect(
			fooTransaction(async ({ fooEvents }) => {
				await fooEvents.publish("foo.created", { fooId });
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");

		expect(await jobsData("bar.foo-created")).toEqual(before);
	});
});
