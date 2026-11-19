import { type PostgresPool, postgresPoolCreate } from "@n8io/baseline-postgres";
import { queueCreate, queueEventsCreate } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll } from "vitest";
import { integrationDatabaseCreate } from "../../../../../test/integration/integration-database.ts";
import { barRepositoryContract } from "./bar-repository.contract.ts";
import { barRepositoryPostgresCreate } from "./bar-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

let pgPool: PostgresPool;
const closes: (() => Promise<void>)[] = [];

// One migrated database for every test: each test uses its own fooId.
beforeAll(async () => {
	const { databaseUrl, drop } = await integrationDatabaseCreate();
	pgPool = postgresPoolCreate({ databaseUrl, max: 4 });
	closes.push(drop, () => pgPool.end());
});

afterAll(async () => {
	for (const close of closes.reverse()) await close();
});

barRepositoryContract(async () => {
	// piece-start: queue
	const queue = await queueCreate({ pgPool, role: "publisher" });
	closes.push(() => queue.stop());
	// piece-end: queue
	return {
		barReadRepository: barRepositoryPostgresCreate(drizzle({ client: pgPool })),
		fooTransaction: fooTransactionPostgresCreate(
			pgPool,
			// piece-start: queue
			queueEventsCreate(queue),
			// piece-end: queue
		),
	};
});
