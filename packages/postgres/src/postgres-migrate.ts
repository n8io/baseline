import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { postgresUrlAssert } from "./postgres-url-assert.ts";
import {
	type PostgresVendorOwnedKey,
	postgresVendorAssert,
} from "./postgres-vendor-assert.ts";

// A fixed 64-bit advisory lock key: the first 8 bytes of SHA-256("baseline:migrate").
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

// Applies pending Drizzle migrations under an advisory lock, so concurrent runs (several
// containers starting at once) apply each migration once: a second run waits, then finds nothing.
export const postgresMigrate = async (options: {
	databaseUrl: string;
	migrationsFolder: string;
	/** Settings only pg has, such as `ssl`: the same ones the pool takes. */
	vendor?: PostgresMigrateVendorOptions;
}): Promise<void> => {
	postgresUrlAssert(options.databaseUrl);
	postgresVendorAssert({
		vendor: options.vendor ?? {},
		databaseUrl: options.databaseUrl,
	});
	const pgClient = new pg.Client({
		...options.vendor,
		connectionString: options.databaseUrl,
		connectionTimeoutMillis: 3_000,
	});
	await pgClient.connect();
	try {
		// Wait for the lock without a limit, then cap each migration's wait for table locks.
		await pgClient.query("SET statement_timeout = 0");
		await pgClient.query("SELECT pg_advisory_lock($1::bigint)", [
			postgresMigrateLockKey,
		]);
		await pgClient.query("SET lock_timeout = '5s'");
		await migrate(drizzle({ client: pgClient }), {
			migrationsFolder: options.migrationsFolder,
		});
	} finally {
		// Closing the session also releases the advisory lock.
		await pgClient.end();
	}
};
