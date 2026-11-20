import {
	type PostgresPool,
	postgresPoolCreate,
	postgresTransactionRun,
} from "@n8io/baseline-postgres";
import { err, ok } from "@n8io/baseline-result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { queueInboxInsert, queueMigrate } from "./index.ts";

let pgPool: PostgresPool;

beforeAll(async () => {
	const databaseUrl = await postgresTestDatabaseCreate();
	await queueMigrate({ databaseUrl });
	pgPool = postgresPoolCreate({ databaseUrl });
});

afterAll(async () => {
	await pgPool.end();
});

const inboxCount = async (consumer: string): Promise<number> => {
	const { rows } = await pgPool.query<{ count: number }>(
		"SELECT count(*)::int AS count FROM queue.inbox WHERE consumer = $1",
		[consumer],
	);
	return rows[0]?.count ?? 0;
};

describe("queueInboxInsert", () => {
	it("is true the first time an Event is recorded for a Consumer, false the repeat", async () => {
		const inbox = { consumer: "billing.foo-created", eventId: "event-1" };

		expect(await queueInboxInsert(pgPool, inbox)).toBe(true);
		expect(await queueInboxInsert(pgPool, inbox)).toBe(false);
		expect(
			await queueInboxInsert(pgPool, { ...inbox, eventId: "event-2" }),
		).toBe(true);
		expect(
			await queueInboxInsert(pgPool, {
				...inbox,
				consumer: "audit.foo-created",
			}),
		).toBe(true);
		expect(await inboxCount("billing.foo-created")).toBe(2);
	});

	it("is rolled back with its transaction, so the Event is not recorded", async () => {
		const inbox = { consumer: "billing.rolled-back", eventId: "event-1" };

		await postgresTransactionRun<undefined, { type: string }>({
			pgPool,
			work: async (pgClient) => {
				expect(await queueInboxInsert(pgClient, inbox)).toBe(true);
				return err({ type: "Rollback" });
			},
		});

		expect(await inboxCount("billing.rolled-back")).toBe(0);
		expect(await queueInboxInsert(pgPool, inbox)).toBe(true);
	});

	it("is kept when its transaction commits", async () => {
		const inbox = { consumer: "billing.committed", eventId: "event-1" };

		await postgresTransactionRun({
			pgPool,
			work: async (pgClient) => {
				await queueInboxInsert(pgClient, inbox);
				return ok(undefined);
			},
		});

		expect(await inboxCount("billing.committed")).toBe(1);
		expect(await queueInboxInsert(pgPool, inbox)).toBe(false);
	});
});
