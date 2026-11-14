import { type Id, idCreate, idToUuid } from "@n8io/baseline-id";
import { drizzle } from "drizzle-orm/node-postgres";
import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type PostgresKeysetKind,
	postgresIdColumnCreate,
	postgresKeysetCreate,
	postgresPoolCreate,
} from "./index.ts";

const item = pgTable("item", {
	at: timestamp({ withTimezone: true }).notNull(),
	id: postgresIdColumnCreate("item")().primaryKey(),
	name: text().notNull(),
	score: integer().notNull(),
});

type Item = typeof item.$inferSelect;

const at = (minute: number) => new Date(Date.UTC(2026, 0, 1, 0, minute));
// Ties on every sort column, and names whose byte order differs from a locale's.
const rows: Omit<Item, "id">[] = [
	{ at: at(3), name: "b", score: 2 },
	{ at: at(1), name: "B", score: 1 },
	{ at: at(3), name: "a", score: 2 },
	{ at: at(2), name: "A", score: 3 },
	{ at: at(1), name: "b", score: 1 },
];

const sorts = {
	date: { column: item.at, sortValue: (row: Item) => row.at.toISOString() },
	number: { column: item.score, sortValue: (row: Item) => row.score },
	text: { column: item.name, sortValue: (row: Item) => row.name },
} as const;

const compare = (a: string | number, b: string | number): number =>
	a < b ? -1 : a > b ? 1 : 0;

describe("postgresKeysetCreate", () => {
	it.each(
		(["date", "number", "text"] as const).flatMap((kind) => [
			{ descending: false, kind },
			{ descending: true, kind },
		]),
	)(
		"pages $kind (descending: $descending) in byte order with the id as tie-breaker",
		async ({
			descending,
			kind,
		}: {
			descending: boolean;
			kind: PostgresKeysetKind;
		}) => {
			await using pgPool = postgresPoolCreate({
				databaseUrl: await postgresTestDatabaseCreate(),
			});
			const db = drizzle({ client: pgPool });
			await db.execute(
				"CREATE TABLE item (at timestamptz NOT NULL, id uuid PRIMARY KEY, name text NOT NULL, score integer NOT NULL)",
			);
			const inserted = await db
				.insert(item)
				.values(rows.map((row) => ({ ...row, id: idCreate("item") })))
				.returning();
			const { column, sortValue } = sorts[kind];
			const expected = inserted
				.toSorted((a, b) => {
					const order =
						compare(sortValue(a), sortValue(b)) ||
						compare(idToUuid(a.id), idToUuid(b.id));
					return descending ? -order : order;
				})
				.map((row) => row.id);

			const seen: Id<"item">[] = [];
			let after: { id: string; value: string | number } | null = null;
			for (let page = 0; page < 5; page += 1) {
				const keyset = postgresKeysetCreate({
					after,
					descending,
					idColumn: item.id,
					kind,
					sortColumn: column,
				});
				const found = await db
					.select()
					.from(item)
					.where(keyset.where)
					.orderBy(...keyset.orderBy)
					.limit(2);
				seen.push(...found.map((row) => row.id));
				const last = found.at(-1);
				if (found.length < 2 || !last) break;
				after = { id: last.id, value: sortValue(last) };
			}

			expect(seen).toEqual(expected);
		},
	);
});
