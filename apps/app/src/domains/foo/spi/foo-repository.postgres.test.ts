import { postgresPoolCreate } from "@n8io/baseline-postgres";
import { queueCreate } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll } from "vitest";
import { integrationDatabaseCreate } from "../../../../test/integration/integration-database.ts";
import { fooRepositoryContract } from "./foo-repository.contract.ts";
import { fooRepositoryPostgresCreate } from "./foo-repository.postgres.ts";
import { fooTransactionPostgresCreate } from "./foo-transaction.postgres.ts";

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
	for (const cleanup of cleanups) await cleanup();
});

// Fresh, empty, migrated database per call.
fooRepositoryContract(async () => {
	const { databaseUrl, drop } = await integrationDatabaseCreate();
	const pgPool = postgresPoolCreate({ databaseUrl, max: 4 });
	cleanups.push(() => pgPool.end(), drop);
	// piece-start: queue
	const queue = await queueCreate({ pgPool, role: "publisher" });
	cleanups.unshift(() => queue.stop());
	// piece-end: queue
	return {
		fooReadRepository: fooRepositoryPostgresCreate(drizzle({ client: pgPool })),
		fooTransaction: fooTransactionPostgresCreate(
			pgPool,
			// piece-start: queue
			queue,
			// piece-end: queue
		),
	};
});
