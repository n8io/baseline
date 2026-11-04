import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { liveHubMemoryCreate } from "@n8io/baseline-live";
import { postgresPoolCreate } from "@n8io/baseline-postgres";
import { type Queue, queueCreate } from "@n8io/baseline-queue";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "../../../../test/integration/integration-database.ts";
import { invoiceLinePortsCreate } from "../spi/index.ts";
import { invoiceLineUseCasesCreate } from "../use-cases/invoice-line-use-cases-create.ts";
import { invoiceLineCustomerDeletedConsumer } from "./invoice-line-customer-deleted-consumer.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
let pgPool: pg.Pool;
let queue: Queue;
let drop: () => Promise<void>;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	pgPool = postgresPoolCreate({ databaseUrl: database.databaseUrl, max: 4 });
	queue = await queueCreate({ pgPool, role: "publisher" });
});

afterAll(async () => {
	await queue.stop();
	await pgPool.end();
	await drop();
});

describe("the customer.deleted consumer on Postgres", () => {
	const portsCreate = () =>
		invoiceLinePortsCreate({
			cache: "memory",
			customerReader: { get: async () => ({ name: "Acme" }) },
			database: pgPool,
			liveHub: liveHubMemoryCreate(),
			queue,
		});

	it("clears the customer once and skips a repeat of the same event", async () => {
		const u = invoiceLineUseCasesCreate(portsCreate());
		const customerId = idCreate("customer");
		const billed = async (name: string) => {
			const created = await u.invoiceLineCreate(owner, { name });
			if (!created.ok) throw created.error;
			const assigned = await u.invoiceLineCustomerAssign(owner, {
				customerId,
				invoiceLineId: created.value.id,
			});
			if (!assigned.ok) throw assigned.error;
			expect(assigned.value.customerId).toBe(customerId);
			return created.value.id;
		};
		const consumer = invoiceLineCustomerDeletedConsumer(u);
		const inbox = { consumer: consumer.queueName, eventId: "job-1" };
		const first = await billed("Billed before the event");

		expect(await consumer.run({ customerId }, inbox)).toEqual({
			ok: true,
			value: undefined,
		});
		const cleared = await u.invoiceLineGet(owner, { invoiceLineId: first });
		expect(cleared.ok && cleared.value.customerId).toBeUndefined();

		// A redelivery of the same job: the inbox row makes it a no-op.
		const later = await billed("Billed after the event");
		expect(await consumer.run({ customerId }, inbox)).toEqual({
			ok: true,
			value: undefined,
		});
		const kept = await u.invoiceLineGet(owner, { invoiceLineId: later });
		expect(kept.ok && kept.value.customerId).toBe(customerId);
		const { rows } = await pgPool.query(
			"SELECT event_id FROM queue.inbox WHERE consumer = $1",
			[consumer.queueName],
		);
		expect(rows).toEqual([{ event_id: "job-1" }]);
	});
});
