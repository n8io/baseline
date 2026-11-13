import { logger } from "@n8io/baseline-logger";
import pg from "pg";
import { postgresUrlAssert } from "./postgres-url-assert.ts";

/** The process's Postgres connection pool. Close it with `end()`. */
export type PostgresPool = pg.Pool;

/** One connection checked out of the pool: what `postgresTransactionRun` hands to its work. */
export type PostgresClient = pg.PoolClient;

export type PostgresPoolOptions = {
	databaseUrl: string;
	/** How long a connect may take. Default 3 s. */
	connectTimeoutMs?: number;
	/** The most connections the pool opens. Default 10. */
	max?: number;
};

// One pool per process. pg 8.23 ignores ?connect_timeout= in the URL, so settings live here.
export const postgresPoolCreate = ({
	connectTimeoutMs = 3_000,
	databaseUrl,
	max = 10,
}: PostgresPoolOptions): PostgresPool => {
	postgresUrlAssert(databaseUrl);
	const pgPool = new pg.Pool({
		connectionString: databaseUrl,
		connectionTimeoutMillis: connectTimeoutMs,
		keepAlive: true,
		max,
	});
	// pg re-emits idle-client errors on the pool; without a listener Node exits.
	pgPool.on("error", (error) => {
		logger.error({ err: error }, "Postgres idle client error");
	});
	return pgPool;
};
