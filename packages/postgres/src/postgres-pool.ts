import { logger } from "@n8io/baseline-logger";
import pg from "pg";
import { postgresUrlAssert } from "./postgres-url-assert.ts";

// One pool per process. pg 8.23 ignores ?connect_timeout= in the URL, so settings live here.
export const postgresPoolCreate = (
	options: { databaseUrl: string } & Partial<pg.PoolConfig>,
): pg.Pool => {
	const { databaseUrl, ...overrides } = options;
	postgresUrlAssert(databaseUrl);
	const pgPool = new pg.Pool({
		connectionString: databaseUrl,
		connectionTimeoutMillis: 3_000,
		keepAlive: true,
		max: 10,
		...overrides,
	});
	// pg re-emits idle-client errors on the pool; without a listener Node exits.
	pgPool.on("error", (error) => {
		logger.error({ err: error }, "Postgres idle client error");
	});
	return pgPool;
};
