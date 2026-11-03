import { postgresPoolCreate } from "@n8io/baseline-postgres";
import { queueCreate, queueStop } from "@n8io/baseline-queue";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll } from "vitest";
import { integrationDatabaseCreate } from "../../../../test/integration/integration-database.ts";
import { fooRepositoryContract } from "./foo-repository.contract.ts";
import { fooRepositoryPostgres } from "./foo-repository.postgres.ts";
import { fooTransactionPostgres } from "./foo-transaction.postgres.ts";

const cleanups: (() => Promise<void>)[] = [];

afterAll(async () => {
	for (const cleanup of cleanups) await cleanup();
});

// Fresh, empty, migrated database per call.
fooRepositoryContract(async () => {
	const { databaseUrl, drop } = await integrationDatabaseCreate();
	const pgPool = postgresPoolCreate({ databaseUrl, max: 4 });
	const queue = await queueCreate({ pgPool, role: "publisher" });
	cleanups.push(
		() => queueStop(queue),
		() => pgPool.end(),
		drop,
	);
	return {
		fooReadRepository: fooRepositoryPostgres(drizzle({ client: pgPool })),
		fooTransaction: fooTransactionPostgres(pgPool, queue),
	};
});
