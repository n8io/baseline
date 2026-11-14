import { integer, pgTable, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { postgresKeysetCreate } from "./index.ts";

const item = pgTable("item", {
	id: text().primaryKey(),
	score: integer().notNull(),
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
});
