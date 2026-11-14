import { type Id, idCreate, idToUuid } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import {
	type Cursor,
	type CursorKind,
	cursorDecode,
	cursorEncode,
	cursorMemoryPage,
} from "./cursor.ts";

const encoded = (value: unknown): string =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

const decode = (cursor: string, kind: CursorKind = "date") =>
	cursorDecode({ cursor, kind, prefix: "invoice" });

describe("cursor", () => {
	it("decodes what it encodes", () => {
		const cursor: Cursor<"invoice"> = {
			id: idCreate("invoice"),
			kind: "date",
			value: "2026-11-03T00:00:00.000Z",
		};

		expect(decode(cursorEncode(cursor))).toEqual(cursor);
	});

	it("reads a cursor that does not decode as none", () => {
		const id = idCreate("invoice");

		expect(decode("not-a-cursor")).toBeNull();
		expect(decode(encoded(null))).toBeNull();
		expect(decode(encoded({ id, kind: "date", value: 1 }), "date")).toBeNull();
		expect(
			decode(encoded({ id: "x", kind: "text", value: "a" }), "text"),
		).toBeNull();
		// Right prefix, not an id.
		expect(
			decode(encoded({ id: "invoice_x", kind: "text", value: "a" }), "text"),
		).toBeNull();
	});

	it("reads a cursor from another sort as none", () => {
		const cursor = cursorEncode({
			id: idCreate("invoice"),
			kind: "text",
			value: "2026-11-03T00:00:00.000Z",
		});

		expect(decode(cursor, "text")).not.toBeNull();
		expect(decode(cursor, "date")).toBeNull();
		expect(decode(cursor, "number")).toBeNull();
	});

	it("reads a value that is not one of its kind as none", () => {
		const id = idCreate("invoice");
		const read = (kind: CursorKind, value: unknown) =>
			decode(encoded({ id, kind, value }), kind);

		expect(read("date", "yesterday")).toBeNull();
		expect(read("date", "2026-02-30T00:00:00.000Z")).toBeNull();
		expect(read("date", "2026-11-03")).toBeNull();
		expect(read("date", "+010000-01-01T00:00:00.000Z")).toBeNull();
		expect(read("text", "a\u0000b")).toBeNull();
		expect(read("number", "3")).toBeNull();
		expect(read("number", null)).toBeNull();
		expect(read("text", 3)).toBeNull();
		expect(read("number", 3)).not.toBeNull();
	});

	it("reads an id with another prefix as none", () => {
		const cursor = encoded({
			id: idCreate("customer"),
			kind: "text",
			value: "a",
		});

		expect(decode(cursor, "text")).toBeNull();
	});
});

type Row = { id: Id<"invoice">; name: string; total: number };

describe("cursorMemoryPage", () => {
	const row = (name: string, total: number): Row => ({
		id: idCreate("invoice"),
		name,
		total,
	});
	// Equal totals and names that differ only in case, so ties and byte order both matter.
	const rows = [
		row("b", 2),
		row("B", 1),
		row("a", 2),
		row("A", 3),
		row("b", 1),
	];
	const sorts = {
		number: { kind: "number", sortValue: (r: Row) => r.total },
		text: { kind: "text", sortValue: (r: Row) => r.name },
	} as const;

	it.each([
		{ descending: false, sort: "number" },
		{ descending: true, sort: "number" },
		{ descending: false, sort: "text" },
		{ descending: true, sort: "text" },
	] as const)(
		"pages $sort (descending: $descending) to the end, ties by id",
		({ descending, sort }) => {
			const { kind, sortValue } = sorts[sort];
			const expected = [...rows].sort((a, b) => {
				const order =
					(sortValue(a) < sortValue(b)
						? -1
						: sortValue(a) > sortValue(b)
							? 1
							: 0) || (idToUuid(a.id) < idToUuid(b.id) ? -1 : 1);
				return descending ? -order : order;
			});
			const seen: Row[] = [];
			let after: Cursor<"invoice"> | null = null;
			for (let guard = 0; guard < 10; guard += 1) {
				const page: { items: Row[]; nextCursor: string | null } =
					cursorMemoryPage({
						after,
						descending,
						items: rows,
						kind,
						limit: 2,
						sortValue,
					});
				seen.push(...page.items);
				if (page.nextCursor === null) break;
				after = cursorDecode({
					cursor: page.nextCursor,
					kind,
					prefix: "invoice",
				});
			}

			expect(seen.map((r) => r.id)).toEqual(expected.map((r) => r.id));
		},
	);

	it("gives no cursor when everything fits", () => {
		expect(
			cursorMemoryPage({
				descending: false,
				items: rows,
				kind: "number",
				limit: 5,
				sortValue: (r) => r.total,
			}).nextCursor,
		).toBeNull();
	});
});
