import { asc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { BarRepository } from "../../domain/repositories.ts";
import { bar } from "./bar-table.ts";

// A nested Drizzle transaction is a compile error: fooTransaction owns the transaction.
type BarDatabase = Omit<NodePgDatabase, "transaction">;

export const barRepositoryPostgresCreate = (
	db: BarDatabase,
): BarRepository => ({
	deleteByFooId: async (fooId) => {
		const deleted = await db
			.delete(bar)
			.where(eq(bar.fooId, fooId))
			.returning({ id: bar.id });
		return deleted.length;
	},
	insert: async (value) => {
		await db.insert(bar).values(value);
	},
	listByFooId: async (fooId) =>
		db
			.select()
			.from(bar)
			.where(eq(bar.fooId, fooId))
			.orderBy(asc(bar.createdAt), asc(bar.id)),
});
