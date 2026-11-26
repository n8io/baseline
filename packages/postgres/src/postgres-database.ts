import { drizzle } from "drizzle-orm/node-postgres";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import pg from "pg";
import type { PostgresClient } from "./postgres-pool.ts";

/** A Drizzle database on one `PostgresClient`: build queries with it. */
export type PostgresDatabase = PgAsyncDatabase<PgQueryResultHKT>;

/**
 * Wraps a `PostgresClient` in Drizzle: the pool for a read, or the client `postgresTransactionRun`
 * hands to its work for a write in that transaction. Throws a TypeError at the call on a client
 * this Package did not create.
 */
export const postgresDatabaseCreate = (
	pgClient: PostgresClient,
): PostgresDatabase => {
	if (!(pgClient instanceof pg.Pool || pgClient instanceof pg.Client)) {
		throw new TypeError(
			"postgresDatabaseCreate: pgClient must come from postgresPoolCreate or postgresTransactionRun",
		);
	}
	return drizzle({ client: pgClient });
};
