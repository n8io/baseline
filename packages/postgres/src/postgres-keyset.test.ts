import {
	doublePrecision,
	integer,
	pgTable,
	serial,
	smallint,
	smallserial,
	text,
} from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { postgresKeysetCreate } from "./index.ts";

const item = pgTable("item", {
	id: text().primaryKey(),
	ratio: doublePrecision().notNull(),
	rank: smallint().notNull(),
	score: integer().notNull(),
	seq: serial().notNull(),
	smallSeq: smallserial().notNull(),
});

describe("postgresKeysetCreate", () => {
	it("gives only the order on the first page", () => {
		const keyset = postgresKeysetCreate({
			descending: false,
			idColumn: item.id,
			kind: "number",
			sortColumn: item.score,
		});

		expect(keyset.where).toBeUndefined();
		expect(keyset.orderBy).toHaveLength(2);
	});

	it("takes an ISO instant with any offset for a date keyset", () => {
		for (const value of [
			"2026-01-01T00:00:00.000Z",
			"2026-01-01T02:00:00.123456+05:00",
		]) {
			expect(
				postgresKeysetCreate({
					after: { id: "x", value },
					descending: false,
					idColumn: item.id,
					kind: "date",
					sortColumn: item.score,
				}).where,
			).toBeDefined();
		}
	});

	it.each([
		{ kind: "number", value: "3" },
		{ kind: "number", value: Number.NaN },
		{ kind: "text", value: 3 },
		{ kind: "date", value: "not a date" },
		{ kind: "date", value: "2026" },
		{ kind: "date", value: "2026-02-30T00:00:00.000Z" },
		{ kind: "date", value: "2026-01-01T00:00:00" },
		{ kind: "date", value: 3 },
	] as const)(
		"throws a TypeError for a $kind keyset after $value",
		({ kind, value }) => {
			expect(() =>
				postgresKeysetCreate({
					after: { id: "x", value },
					descending: false,
					idColumn: item.id,
					kind,
					sortColumn: item.score,
				}),
			).toThrow(TypeError);
		},
	);

	// Postgres refuses a number its integer column cannot hold; a missed cursor check fails here,
	// not as a 500 from Postgres.
	it.each([
		{ column: "score", kind: "integer", value: 9.5 },
		{ column: "score", kind: "integer", value: 3e9 },
		{ column: "score", kind: "number", value: -3e9 },
		{ column: "score", kind: "number", value: 9.5 },
		{ column: "rank", kind: "number", value: 40_000 },
		{ column: "seq", kind: "integer", value: 2 ** 31 },
		{ column: "smallSeq", kind: "number", value: -40_000 },
	] as const)(
		"throws a TypeError for a $kind keyset on $column after $value",
		({ column, kind, value }) => {
			expect(() =>
				postgresKeysetCreate({
					after: { id: "x", value },
					descending: false,
					idColumn: item.id,
					kind,
					sortColumn: item[column],
				}),
			).toThrow(/needs an integer from/);
		},
	);

	it("takes a number its column holds", () => {
		for (const [column, kind, value] of [
			["score", "integer", 2 ** 31 - 1],
			["score", "number", -(2 ** 31)],
			["rank", "number", -32_768],
			["ratio", "number", 9.5],
			// A serial holds what its integer holds, zero and negatives too.
			["seq", "integer", 0],
			["seq", "number", -5],
			["smallSeq", "number", -32_768],
		] as const) {
			expect(
				postgresKeysetCreate({
					after: { id: "x", value },
					descending: false,
					idColumn: item.id,
					kind,
					sortColumn: item[column],
				}).where,
			).toBeDefined();
		}
	});

	// cursorDecode lets through any int4 value, so `integer` on a narrower or non-integer column
	// would still fail: it throws even on the first page, where a test meets it.
	it.each(["rank", "ratio", "smallSeq"] as const)(
		"throws a TypeError for an integer keyset on %s",
		(column) => {
			expect(() =>
				postgresKeysetCreate({
					descending: false,
					idColumn: item.id,
					kind: "integer",
					sortColumn: item[column],
				}),
			).toThrow(/needs an integer or serial column/);
		},
	);
});
