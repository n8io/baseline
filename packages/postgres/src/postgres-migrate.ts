import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import {
	postgresDurationIsValid,
	postgresDurationMessage,
} from "./postgres-pool.ts";
import { postgresUrlAssert } from "./postgres-url-assert.ts";
import {
	type PostgresVendorOwnedKey,
	postgresVendorAssert,
} from "./postgres-vendor-assert.ts";

/** A fixed 64-bit advisory lock key: the first 8 bytes of SHA-256("baseline:migrate"). */
export const postgresMigrateLockKey: string = createHash("sha256")
	.update("baseline:migrate")
	.digest()
	.readBigInt64BE(0)
	.toString();

/**
 * pg's own client settings for the migration's one connection, passed through as they are.
 * Outside this Package's contract, like `PostgresPoolVendorOptions`.
 */
export type PostgresMigrateVendorOptions = Omit<
	pg.ClientConfig,
	PostgresVendorOwnedKey
>;

// Postgres's error code for a statement that gave up waiting for a lock.
const lockNotAvailable = "55P03";

/** What `postgresMigrate` takes. */
export type PostgresMigrateOptions = {
	/** The Postgres URL, `postgres://` or `postgresql://`; it must reach Postgres, not a pooler. */
	databaseUrl: string;
	/** How long the connect may take. Default 3 s. */
	connectTimeoutMs?: number | null;
	/** How long to wait for another run to release the lock. Default 60 s. */
	lockWaitMs?: number | null;
	/** The folder of Drizzle migrations to apply. */
	migrationsFolder: string;
	/** Settings only pg has, such as `ssl`: the same ones the pool takes. */
	vendor?: PostgresMigrateVendorOptions | null;
};

/**
 * Applies pending Drizzle migrations under an advisory lock, so concurrent runs (several
 * containers starting at once) apply each migration once: a second run waits, then finds nothing.
 * The lock belongs to the session, so the connection must reach Postgres itself, not a pooler.
 * Throws a TypeError at the call on a `databaseUrl` that is not a Postgres URL, a `vendor` key the
 * named options or the URL already set, or a `connectTimeoutMs` or `lockWaitMs` that is not a
 * positive integer or is over 2147483647.
 */
export const postgresMigrate = async (
	options: PostgresMigrateOptions,
): Promise<void> => {
	postgresUrlAssert(options.databaseUrl, "postgresMigrate");
	postgresVendorAssert({
		caller: "postgresMigrate",
		databaseUrl: options.databaseUrl,
		vendor: options.vendor ?? {},
	});
	const connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
	if (!postgresDurationIsValid(connectTimeoutMs)) {
		throw new TypeError(
			`postgresMigrate: connectTimeoutMs must be ${postgresDurationMessage}, found ${connectTimeoutMs}`,
		);
	}
	const lockWaitMs = options.lockWaitMs ?? 60_000;
	if (!postgresDurationIsValid(lockWaitMs)) {
		throw new TypeError(
			`postgresMigrate: lockWaitMs must be ${postgresDurationMessage}, found ${lockWaitMs}`,
		);
	}
	// @types/pg leaves out processID: the backend pid the server named at connect.
	const pgClient: pg.Client & { processID?: number | null } = new pg.Client({
		...options.vendor,
		connectionString: options.databaseUrl,
		connectionTimeoutMillis: connectTimeoutMs,
	});
	await pgClient.connect();
	try {
		// A pooler answers the connect with a pid of its own. Checked before any session setting, so
		// nothing is left behind on a pooled connection.
		const { rows } = await pgClient.query<{ pid: number }>(
			"SELECT pg_backend_pid() AS pid",
		);
		if (rows[0]?.pid !== pgClient.processID) {
			throw new Error(
				"postgresMigrate needs a direct connection to Postgres: databaseUrl goes through a connection pooler, which can hand the migrate lock to another session and keep it after this run ends. Use a URL that reaches Postgres itself",
			);
		}
		await pgClient.query("SET statement_timeout = 0");
		await pgClient.query(`SET lock_timeout = '${lockWaitMs}ms'`);
		try {
			await pgClient.query("SELECT pg_advisory_lock($1::bigint)", [
				postgresMigrateLockKey,
			]);
		} catch (error) {
			if ((error as { code?: unknown }).code !== lockNotAvailable) throw error;
			throw new Error(
				`postgresMigrate waited ${lockWaitMs} ms for the migrate lock (advisory lock ${postgresMigrateLockKey}) and gave up: another migrate is still running, or one that ran through a connection pooler left the lock on a pooled connection. Find the holder in pg_locks (locktype 'advisory') and end that session`,
				{ cause: error },
			);
		}
		// Cap each migration's wait for table locks.
		await pgClient.query("SET lock_timeout = '5s'");
		await migrate(drizzle({ client: pgClient }), {
			migrationsFolder: options.migrationsFolder,
		});
	} finally {
		// Closing the session also releases the advisory lock.
		await pgClient.end();
	}
};
