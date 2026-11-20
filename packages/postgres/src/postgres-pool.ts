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

/** What `postgresPoolCreate` takes. */
export type PostgresPoolOptions = {
	databaseUrl: string;
	/** How long a connect may take. Default 3 s. */
	connectTimeoutMs?: number | null;
	/** The most connections the pool opens. Default 10. */
	max?: number | null;
	/**
	 * How long the caller waits for one query before it rejects. Default 15 s. Unlike every other
	 * option, `null` does not mean the default: it turns the limit off. The pool closes that
	 * connection; the server may still finish the query.
	 */
	queryTimeoutMs?: number | null;
	/** Settings only pg has, such as `ssl` or `idleTimeoutMillis`. */
	vendor?: PostgresPoolVendorOptions | null;
};

const postgresPositiveIntegerIs = (value: number): boolean =>
	Number.isSafeInteger(value) && value > 0;

/**
 * The process's one Postgres pool. pg 8.23 ignores `?connect_timeout=` in the URL, so the
 * settings live here.
 */
export const postgresPoolCreate = (
	options: PostgresPoolOptions,
): PostgresPool => {
	const { databaseUrl, queryTimeoutMs = 15_000 } = options;
	const connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
	const max = options.max ?? 10;
	const vendor = options.vendor ?? {};
	postgresUrlAssert(databaseUrl, "postgresPoolCreate");
	postgresVendorAssert({
		caller: "postgresPoolCreate",
		databaseUrl,
		owned: { max: "max", query_timeout: "queryTimeoutMs" },
		vendor,
	});
	if (!postgresPositiveIntegerIs(connectTimeoutMs)) {
		throw new TypeError(
			"postgresPoolCreate: connectTimeoutMs must be a positive integer",
		);
	}
	if (!postgresPositiveIntegerIs(max)) {
		throw new TypeError("postgresPoolCreate: max must be a positive integer");
	}
	if (queryTimeoutMs !== null && !postgresPositiveIntegerIs(queryTimeoutMs)) {
		throw new TypeError(
			"postgresPoolCreate: queryTimeoutMs must be a positive integer or null",
		);
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
