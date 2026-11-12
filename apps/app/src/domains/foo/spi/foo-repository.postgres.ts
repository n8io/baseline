import { idToUuid } from "@n8io/baseline-id";
import { postgresUniqueViolationIs } from "@n8io/baseline-postgres";
import { err, ok } from "@n8io/baseline-result";
import {
	and,
	count,
	eq,
	isNotNull,
	isNull,
	lt,
	type SQL,
	sql,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { cursorDecode, cursorEncode } from "../../../cursor.ts";
import { FooNameTakenError } from "../foo-errors.ts";
import type { Foo } from "../models/foo.ts";
import type { FooRepository } from "../ports.ts";
import { foo } from "./foo-table.ts";

// A nested Drizzle transaction is a compile error: fooTransaction owns the transaction.
type FooDatabase = Omit<NodePgDatabase, "transaction">;

const fooFromRow = (row: typeof foo.$inferSelect): Foo => ({
	archivedAt: row.archivedAt,
	createdAt: row.createdAt,
	createdBy: row.createdBy,
	id: row.id,
	name: row.name,
	updatedAt: row.updatedAt,
});

export const fooRepositoryPostgresCreate = (
	db: FooDatabase,
): FooRepository => ({
	archiveStale: async (before, now) => {
		const archived = await db
			.update(foo)
			.set({ archivedAt: now })
			.where(and(isNull(foo.archivedAt), lt(foo.updatedAt, before)))
			.returning({ id: foo.id });
		return archived.length;
	},
	delete: async (id) => {
		await db.delete(foo).where(eq(foo.id, id));
	},
	findById: async (id) => {
		const [row] = await db.select().from(foo).where(eq(foo.id, id));
		return row && fooFromRow(row);
	},
	insert: async (value) => {
		try {
			const [row] = await db.insert(foo).values(value).returning();
			if (!row) throw new Error(`Foo ${value.id} was not inserted`);
			return ok(fooFromRow(row));
		} catch (error) {
			if (postgresUniqueViolationIs(error, "foo_name_key")) {
				return err(new FooNameTakenError(value.name));
			}
			throw error;
		}
	},
	list: async (input) => {
		const field = input.sort.replace("-", "") as "createdAt" | "name";
		const descending = input.sort.startsWith("-");
		const archived = input.archived
			? isNotNull(foo.archivedAt)
			: isNull(foo.archivedAt);
		const sortColumn =
			field === "name" ? sql`${foo.name} COLLATE "C"` : sql`${foo.createdAt}`;
		const direction = descending ? sql`DESC` : sql`ASC`;
		const after = input.cursor ? cursorDecode(input.cursor, "foo") : undefined;
		const keyset: SQL | undefined = after
			? sql`(${sortColumn}, ${foo.id}) ${descending ? sql`<` : sql`>`} (${
					field === "name"
						? sql`${after.k} COLLATE "C"`
						: sql`${after.k}::timestamptz`
				}, ${idToUuid(after.id)}::uuid)`
			: undefined;

		const rows = await db
			.select()
			.from(foo)
			.where(and(archived, keyset))
			.orderBy(sql`${sortColumn} ${direction}`, sql`${foo.id} ${direction}`)
			.limit(input.limit + 1);
		const page = rows.slice(0, input.limit).map(fooFromRow);
		const last = page.at(-1);
		const nextCursor =
			rows.length > input.limit && last
				? cursorEncode({
						id: last.id,
						k: field === "name" ? last.name : last.createdAt.toISOString(),
					})
				: null;
		if (!input.count) return { items: page, nextCursor };
		const [counted] = await db
			.select({ total: count() })
			.from(foo)
			.where(archived);
		return { items: page, nextCursor, total: counted?.total ?? 0 };
	},
	update: async (value) => {
		try {
			const [row] = await db
				.update(foo)
				.set(value)
				.where(eq(foo.id, value.id))
				.returning();
			if (!row) throw new Error(`Foo ${value.id} to update does not exist`);
			return ok(fooFromRow(row));
		} catch (error) {
			if (postgresUniqueViolationIs(error, "foo_name_key")) {
				return err(new FooNameTakenError(value.name));
			}
			throw error;
		}
	},
});
