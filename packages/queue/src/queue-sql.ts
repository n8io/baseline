// Anything that runs SQL on the Project's Postgres: the pool, or the client of an open transaction.
// A node-postgres Pool and PoolClient both fit.
export type QueueSql = {
	query(
		text: string,
		values?: unknown[],
	): Promise<{ rowCount: number | null; rows: unknown[] }>;
};
