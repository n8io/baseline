import type { SQL } from "drizzle-orm";
import {
	doublePrecision,
	integer,
	PgDialect,
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
	name: text().notNull(),
	ratio: doublePrecision().notNull(),
	rank: smallint().notNull(),
	score: integer().notNull(),
	seq: serial().notNull(),
	smallSeq: smallserial().notNull(),
});

// The SQL text and bound values a fragment renders to on Postgres.
const rendered = (fragment: SQL | undefined) => {
	if (!fragment) throw new Error("no SQL");
	const { params, sql } = new PgDialect().sqlToQuery(fragment);
	return { params, sql };
};

describe("postgresKeysetCreate", () => {
	it("orders text by byte order, ascending, then by id", () => {
		const keyset = postgresKeysetCreate({
			descending: false,
			idColumn: item.id,
			kind: "text",
			sortColumn: item.name,
		});

		expect(keyset.orderBy.map((order) => rendered(order).sql)).toEqual([
			'"item"."name" COLLATE "C" ASC',
			'"item"."id" ASC',
		]);
	});

	it("orders a number column as it is, descending, then by id", () => {
		const keyset = postgresKeysetCreate({
			descending: true,
			idColumn: item.id,
			kind: "number",
			sortColumn: item.ratio,
		});

		expect(keyset.orderBy.map((order) => rendered(order).sql)).toEqual([
			'"item"."ratio" DESC',
			'"item"."id" DESC',
		]);
	});

	it.each([
		{
			descending: false,
			kind: "text",
			sortColumn: item.name,
			sql: '("item"."name" COLLATE "C", "item"."id") > ($1, $2)',
			value: "Eagles",
		},
		{
			descending: true,
			kind: "text",
			sortColumn: item.name,
			sql: '("item"."name" COLLATE "C", "item"."id") < ($1, $2)',
			value: "Eagles",
		},
		{
			descending: false,
			kind: "date",
			sortColumn: item.name,
			sql: '("item"."name", "item"."id") > ($1::timestamptz, $2)',
			value: "2026-01-01T00:00:00.000Z",
		},
		{
			descending: true,
			kind: "number",
			sortColumn: item.ratio,
			sql: '("item"."ratio", "item"."id") < ($1, $2)',
			value: 9.5,
		},
	] as const)(
		"seeks after the cursor on a $kind keyset, descending $descending",
		({ descending, kind, sortColumn, sql, value }) => {
			const { where } = postgresKeysetCreate({
				after: { id: "x", value },
				descending,
				idColumn: item.id,
				kind,
				sortColumn,
			});

			expect(rendered(where)).toEqual({ params: [value, "x"], sql });
		},
	);

	it.each([
		["number", item.ratio, "9", "a number keyset needs a finite number"],
		[
			"integer",
			item.score,
			9.5,
			"an integer keyset needs an integer from -2147483648 to 2147483647",
		],
		[
			"date",
			item.name,
			"nope",
			"a date keyset needs an ISO instant such as 2026-01-01T00:00:00.000Z",
		],
		["text", item.name, 3, "a text keyset needs a string"],
	] as const)(
		"says what a %s keyset needs when the value is wrong",
		(kind, sortColumn, value, needs) => {
			expect(() =>
				postgresKeysetCreate({
					after: { id: "x", value },
					descending: false,
					idColumn: item.id,
					kind,
					sortColumn,
				}),
			).toThrow(
				new TypeError(
					`postgresKeysetCreate: after.value: ${needs}, found ${JSON.stringify(value)}`,
				),
			);
		},
	);

	it("takes any string for a text keyset, and an instant without a fraction for a date", () => {
		expect(
			postgresKeysetCreate({
				after: { id: "x", value: "not an instant" },
				descending: false,
				idColumn: item.id,
				kind: "text",
				sortColumn: item.name,
			}).where,
		).toBeDefined();
		expect(
			postgresKeysetCreate({
				after: { id: "x", value: "2026-01-01T00:00:00Z" },
				descending: false,
				idColumn: item.id,
				kind: "date",
				sortColumn: item.name,
			}).where,
		).toBeDefined();
	});

	it("refuses a date with text around it", () => {
		for (const value of [
			"on 2026-01-01T00:00:00.000Z",
			"2026-01-01T00:00:00.000Z.",
		]) {
			expect(() =>
				postgresKeysetCreate({
					after: { id: "x", value },
					descending: false,
					idColumn: item.id,
					kind: "date",
					sortColumn: item.name,
				}),
			).toThrow(TypeError);
		}
	});

	it("refuses a smallint just over its range, and takes its largest", () => {
		const keyset = (value: number) =>
			postgresKeysetCreate({
				after: { id: "x", value },
				descending: false,
				idColumn: item.id,
				kind: "number",
				sortColumn: item.rank,
			});

		expect(keyset(32_767).where).toBeDefined();
		expect(() => keyset(32_768)).toThrow(/needs an integer from/);
	});

	it("refuses a kind that is none of the four", () => {
		expect(() =>
			postgresKeysetCreate({
				descending: false,
				idColumn: item.id,
				kind: "Text" as "text",
				sortColumn: item.score,
			}),
		).toThrow(
			new TypeError(
				'postgresKeysetCreate: kind must be "date", "integer", "number" or "text", found "Text"',
			),
		);
	});

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
