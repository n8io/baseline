import { type Id, idFromUuid } from "@n8io/baseline-id";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
	type Cursor,
	type CursorKind,
	cursorDecode,
	cursorEncode,
	cursorMemoryPage,
} from "./cursor.ts";

type Item = { id: Id<"item">; rank: number };

const idArbitrary = fc.uuid().map((uuid) => idFromUuid("item", uuid));

// A value each kind accepts: text without NUL, an instant a four-digit year writes, an int4, a finite number.
const cursorArbitrary: fc.Arbitrary<Cursor<"item">> = fc.oneof(
	fc.record({
		id: idArbitrary,
		kind: fc.constant<CursorKind>("text"),
		value: fc.string().map((text) => text.replaceAll("\0", "")),
	}),
	fc.record({
		id: idArbitrary,
		kind: fc.constant<CursorKind>("date"),
		value: fc
			.date({
				noInvalidDate: true,
				max: new Date("9999-12-31"),
				min: new Date("1000-01-01"),
			})
			.map((date) => date.toISOString()),
	}),
	fc.record({
		id: idArbitrary,
		kind: fc.constant<CursorKind>("integer"),
		value: fc.integer({ max: 2 ** 31 - 1, min: -(2 ** 31) }),
	}),
	fc.record({
		id: idArbitrary,
		kind: fc.constant<CursorKind>("number"),
		value: fc
			// JSON has no -0: it writes it as 0.
			.double({ noNaN: true, noDefaultInfinity: true })
			.map((number) => (Object.is(number, -0) ? 0 : number)),
	}),
);

describe("cursor properties", () => {
	it("cursorDecode returns what cursorEncode wrote, for every kind", () => {
		fc.assert(
			fc.property(cursorArbitrary, (cursor) => {
				expect(
					cursorDecode({
						cursor: cursorEncode(cursor),
						kind: cursor.kind,
						prefix: "item",
					}),
				).toEqual(cursor);
			}),
		);
	});

	it("cursorDecode reads a cursor of another kind as none", () => {
		const kinds: CursorKind[] = ["date", "integer", "number", "text"];

		fc.assert(
			fc.property(
				cursorArbitrary,
				fc.constantFrom(...kinds),
				(cursor, kind) => {
					const decoded = cursorDecode({
						cursor: cursorEncode(cursor),
						kind,
						prefix: "item",
					});

					expect(decoded === null).toBe(kind !== cursor.kind);
				},
			),
		);
	});

	it("cursorDecode never throws on any string", () => {
		fc.assert(
			fc.property(fc.string(), (cursor) => {
				expect(() =>
					cursorDecode({ cursor, kind: "text", prefix: "item" }),
				).not.toThrow();
			}),
		);
	});

	it("paging through items returns each once, in sort order, whatever the page size", () => {
		const items = fc.uniqueArray(
			fc.record({ id: idArbitrary, rank: fc.integer({ max: 20, min: 0 }) }),
			{ selector: (item) => item.id },
		);

		fc.assert(
			fc.property(
				items,
				fc.integer({ max: 7, min: 1 }),
				fc.boolean(),
				(all, limit, descending) => {
					const seen: string[] = [];
					let after: Cursor<"item"> | null = null;
					for (let page = 0; page <= all.length; page++) {
						const result: { items: Item[]; nextCursor: string | null } =
							cursorMemoryPage<"item", Item>({
								after,
								descending,
								items: all,
								kind: "integer",
								limit,
								sortValue: (item) => item.rank,
							});
						seen.push(...result.items.map((item) => item.id));
						if (result.nextCursor === null) break;
						after = cursorDecode({
							cursor: result.nextCursor,
							kind: "integer",
							prefix: "item",
						});
					}
					const once = cursorMemoryPage({
						descending,
						items: all,
						kind: "integer",
						limit: all.length + 1,
						sortValue: (item) => item.rank,
					});

					expect(seen).toEqual(once.items.map((item) => item.id));
					expect(new Set(seen).size).toBe(all.length);
				},
			),
		);
	});
});
