/**
 * Anything that runs SQL on the Project's Postgres: the pool, or the client of an open transaction.
 * A node-postgres Pool and PoolClient both fit.
 */
// mutable: pg-boss types the rows of a query as a mutable array, and a QueueSql is handed to it as is.
export type QueueSql = {
	query(
		text: string,
		values?: readonly unknown[],
	): Promise<{ rowCount: number | null; rows: unknown[] }>;
};
