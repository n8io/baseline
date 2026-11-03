import { createHash } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { postgresUrlAssert } from "./postgres-url-assert.ts";

// A fixed 64-bit advisory lock key: the first 8 bytes of SHA-256("baseline:migrate").
export const postgresMigrateLockKey: string = createHash("sha256")
	.update("baseline:migrate")
	.digest()
	.readBigInt64BE(0)
	.toString();

// Applies pending Drizzle migrations under an advisory lock, so concurrent runs (several
// containers starting at once) apply each migration once: a second run waits, then finds nothing.
export const postgresMigrate = async (options: {
	databaseUrl: string;
	migrationsFolder: string;
}): Promise<void> => {
	postgresUrlAssert(options.databaseUrl);
	const pgClient = new pg.Client({
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
