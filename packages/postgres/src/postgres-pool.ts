import { logger } from "@n8io/baseline-logger";
import pg from "pg";
import { postgresUrlAssert } from "./postgres-url-assert.ts";
import {
	type PostgresVendorOwnedKey,
	postgresVendorAssert,
} from "./postgres-vendor-assert.ts";

/**
 * The process's Postgres connection pool. Close it with `end()`; `await using` calls `end()` when
 * its block ends.
 */
export type PostgresPool = pg.Pool & AsyncDisposable;

/** One connection checked out of the pool: what `postgresTransactionRun` hands to its work. */
export type PostgresClient = pg.PoolClient;

/**
 * pg's own pool settings, passed through as they are. Outside this Package's contract: nothing
 * here is tested, and moving off pg deletes it. The keys the named options and the URL set are
 * refused.
 */
export type PostgresPoolVendorOptions = Omit<
	pg.PoolConfig,
	PostgresVendorOwnedKey | "max" | "query_timeout"
>;

export type PostgresPoolOptions = {
	databaseUrl: string;
	/** How long a connect may take. Default 3 s. */
	connectTimeoutMs?: number;
	/** The most connections the pool opens. Default 10. */
	max?: number;
	/**
	 * How long one query may take before it rejects and its connection is closed. Default 15 s;
	 * `null` turns it off.
	 */
	queryTimeoutMs?: number | null;
	/** Settings only pg has, such as `ssl` or `idleTimeoutMillis`. */
	vendor?: PostgresPoolVendorOptions;
};

// One pool per process. pg 8.23 ignores ?connect_timeout= in the URL, so settings live here.
export const postgresPoolCreate = ({
	connectTimeoutMs = 3_000,
	databaseUrl,
	max = 10,
	queryTimeoutMs = 15_000,
	vendor = {},
}: PostgresPoolOptions): PostgresPool => {
	postgresUrlAssert(databaseUrl);
	postgresVendorAssert({
		vendor,
		databaseUrl,
		owned: { max: "max", query_timeout: "queryTimeoutMs" },
	});
	if (
		queryTimeoutMs !== null &&
		(!Number.isSafeInteger(queryTimeoutMs) || queryTimeoutMs <= 0)
	) {
		throw new TypeError("queryTimeoutMs must be a positive integer or null");
	}
	const pgPool = new pg.Pool({
		// Probe an idle connection after 10 s, not the OS default of about 2 hours, so a dead peer shows.
		keepAlive: true,
		keepAliveInitialDelayMillis: 10_000,
		...vendor,
		connectionString: databaseUrl,
		connectionTimeoutMillis: connectTimeoutMs,
		max,
		// The driver's own timer: it also ends a query whose server went away without closing the socket.
		...(queryTimeoutMs === null ? {} : { query_timeout: queryTimeoutMs }),
	});
	// pg re-emits idle-client errors on the pool; without a listener Node exits.
	pgPool.on("error", (error) => {
		logger.error({ err: error }, "Postgres idle client error");
	});
	return Object.assign(pgPool, {
		[Symbol.asyncDispose]: () => pgPool.end(),
	});
};
