import { type SQL, sql } from "drizzle-orm";

/** Anything that runs a Drizzle query: a Drizzle database or transaction. */
export type PostgresExecutor = { execute(query: SQL): Promise<unknown> };

// Takes a transaction-scoped advisory lock on `key`, waiting while another transaction holds it.
// Postgres releases it at COMMIT or ROLLBACK. Outside a transaction it is released as soon as
// this statement ends, so call it inside postgresTransactionRun.
export const postgresAdvisoryLockTake = async (
	db: PostgresExecutor,
	key: string,
): Promise<void> => {
	await db.execute(
		sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
	);
};
