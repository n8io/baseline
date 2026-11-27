import {
	sharedConnectionUrlAssert,
	sharedIntegerAssert,
	sharedTimerMaxMs,
} from "@n8io/baseline-shared";
import pg from "pg";
import { postgresLoggerDefault as logger } from "./postgres-logger-default.ts";
import {
	type PostgresVendorOwnedKey,
	postgresVendorAssert,
} from "./postgres-vendor-assert.ts";

/**
 * Anything that runs SQL on Postgres: the pool, or the client of an open transaction. For a
 * Drizzle query, wrap it with `postgresDatabaseCreate`.
 */
// mutable: pg-boss types the rows of a query as a mutable array, and the queue hands it this as is.
export type PostgresClient = {
	query<Row = unknown>(
		text: string,
		values?: readonly unknown[],
	): Promise<{ rowCount: number | null; rows: Row[] }>;
};

/**
 * The connection `postgresTransactionRun` checks out of its pool: a client that also reports its
 * errors and goes back to the pool.
 */
export type PostgresTransactionRunConnection = PostgresClient & {
	off(event: "error", listener: (error: Error) => void): unknown;
	on(event: "error", listener: (error: Error) => void): unknown;
	/** Pass `true` to close the connection instead of keeping it. */
	release(discard?: boolean): void;
};

/** The pool `postgresTransactionRun` checks a connection out of: a `PostgresPool` fits. */
export type PostgresTransactionRunPool = {
	connect(): Promise<PostgresTransactionRunConnection>;
};

/**
 * The process's Postgres connection pool. Close it with `end()`; `await using` calls `end()` when
 * its block ends.
 */
export type PostgresPool = PostgresClient &
	PostgresTransactionRunPool &
	AsyncDisposable & { end(): Promise<void> };

/**
 * pg's own pool settings, passed through as they are. Outside this Package's contract: nothing
 * here is tested, and moving off pg deletes it. The keys the named options and the URL set are
 * refused. Not exported from the Package: write the object inline in `src/connections.ts`, where
 * `postgresPoolCreate` takes it.
 */
type PostgresPoolVendorOptions = Omit<
	pg.PoolConfig,
	PostgresVendorOwnedKey | "max" | "query_timeout"
>;

/** What `postgresPoolCreate` takes. */
export type PostgresPoolOptions = {
	/** The Postgres URL, `postgres://` or `postgresql://`. */
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

/**
 * The process's one Postgres pool. pg 8.23 ignores `?connect_timeout=` in the URL, so the
 * settings live here. Throws a TypeError at the call on a `databaseUrl` that is not a Postgres URL,
 * a `vendor` key the named options or the URL already set, a `connectTimeoutMs`, `max` or
 * `queryTimeoutMs` that is not a positive integer, or a duration over 2147483647.
 */
export const postgresPoolCreate = (
	options: PostgresPoolOptions,
): PostgresPool => {
	const { databaseUrl, queryTimeoutMs = 15_000 } = options;
	const connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
	const max = options.max ?? 10;
	const vendor = options.vendor ?? {};
	sharedConnectionUrlAssert(databaseUrl, "postgresPoolCreate");
	postgresVendorAssert({
		caller: "postgresPoolCreate",
		databaseUrl,
		owned: { max: "max", query_timeout: "queryTimeoutMs" },
		vendor,
	});
	sharedIntegerAssert({
		caller: "postgresPoolCreate",
		max: sharedTimerMaxMs,
		min: 1,
		name: "connectTimeoutMs",
		value: connectTimeoutMs,
	});
	sharedIntegerAssert({
		caller: "postgresPoolCreate",
		min: 1,
		name: "max",
		value: max,
	});
	if (queryTimeoutMs !== null) {
		sharedIntegerAssert({
			caller: "postgresPoolCreate",
			max: sharedTimerMaxMs,
			min: 1,
			name: "queryTimeoutMs",
			value: queryTimeoutMs,
		});
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
		logger().error({ err: error }, "Postgres idle client error");
	});
	return Object.assign(pgPool, {
		[Symbol.asyncDispose]: () => pgPool.end(),
	});
};
