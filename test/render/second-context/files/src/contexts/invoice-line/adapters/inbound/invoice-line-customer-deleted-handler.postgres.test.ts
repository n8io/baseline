import { analyticsLoggerCreate } from "@n8io/baseline-analytics";
import type { Actor } from "@n8io/baseline-authn";
import { cacheStoreMemoryCreate } from "@n8io/baseline-cache";
import type { Id } from "@n8io/baseline-id";
import { liveHubMemoryCreate } from "@n8io/baseline-live";
import { type PostgresPool, postgresPoolCreate } from "@n8io/baseline-postgres";
import {
	type Queue,
	queueCreate,
	queueEventsCreate,
} from "@n8io/baseline-queue";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "../../../../../test/integration/integration-database.ts";
import { clockSystemCreate } from "../../../../clock.ts";
import { featureFlagsOpen } from "../../../../feature-flags-open.ts";
import { invoiceLineUseCasesCreate } from "../../application/invoice-line-use-cases.ts";
import { invoiceLinePortsCreate } from "../outbound/index.ts";
import { invoiceLineTestUpstreamCreate } from "../outbound/invoice-line-test-upstream.ts";
import { invoiceLineCustomerDeletedHandlerCreate } from "./invoice-line-customer-deleted-handler.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
let pgPool: PostgresPool;
let queue: Queue;
let drop: () => Promise<void>;

beforeAll(async () => {
	const database = await integrationDatabaseCreate();
	drop = database.drop;
	pgPool = postgresPoolCreate({ databaseUrl: database.databaseUrl, max: 4 });
	queue = await queueCreate({ pgPool, role: "publisher" });
});

afterAll(async () => {
	await queue.close();
	await pgPool.end();
	await drop();
});

describe("the customer.deleted Event handler on Postgres", () => {
	// The customer lives in the real customer context, on memory adapters.
	let customerId: Id<"customer">;
	const upstream = invoiceLineTestUpstreamCreate();
	beforeAll(async () => {
		const customer = await (await upstream).customer.useCases.customerCreate(
			owner,
			{ name: "Acme" },
		);
		if (!customer.ok) throw customer.error;
		customerId = customer.value.id;
	});
	const portsCreate = async () =>
		invoiceLinePortsCreate(
			{
				// piece-start: analytics
				analytics: analyticsLoggerCreate(),
				// piece-end: analytics
				// piece-start: cache
				cacheStore: cacheStoreMemoryCreate(),
				// piece-end: cache
				clock: clockSystemCreate(),
				database: pgPool,
				events: queueEventsCreate(queue),
				// piece-start: feature-flags
				featureFlags: featureFlagsOpen({
					steps: { intakes: [], resources: [] },
				}).featureFlags,
				// piece-end: feature-flags
				intakes: [],
				// piece-start: live
				liveHub: liveHubMemoryCreate(),
				// piece-end: live
				queue,
				// piece-start: redis
				redis: "memory",
				// piece-end: redis
				resources: [],
			},
			await upstream,
		);

	it("clears the customer once and skips a repeat of the same event", async () => {
		const u = invoiceLineUseCasesCreate(await portsCreate());
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
		const consumer = invoiceLineCustomerDeletedHandlerCreate(u);
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
