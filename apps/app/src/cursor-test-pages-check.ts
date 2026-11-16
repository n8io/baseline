import { type Id, idToUuid } from "@n8io/baseline-id";
import { expect } from "vitest";

// A sort's field: the sort value without its leading "-".
type CursorTestSortField<S extends string> = S extends `-${infer F}` ? F : S;

// Byte order for strings, as COLLATE "C" compares. Written apart from cursorMemoryPage's own
// order on purpose: the check must not share the code it checks.
const compare = (a: number | string, b: number | string): number =>
	typeof a === "string" && typeof b === "string"
		? Buffer.compare(Buffer.from(a), Buffer.from(b))
		: a < b
			? -1
			: a > b
				? 1
				: 0;

// A repository contract test helper: for every sort, pages through `list` two items at a time and
// expects every item once, in keyset order (sort value, then id as Postgres compares the uuid).
// Pass the sort enum's every value, and items with ties on each sort value that allows them, so
// the id tie-break counts. `list` pages the same items `items` lists, filters applied.
export const cursorTestPagesCheck = async <
	P extends string,
	T extends { id: Id<P> },
	S extends string,
>({
	items,
	list,
	sorts,
	sortValues,
}: {
	items: T[];
	list: (input: {
		cursor?: string | undefined;
		limit: number;
		sort: S;
	}) => Promise<{ items: T[]; nextCursor: string | null; total?: number }>;
	sorts: readonly S[];
	sortValues: Record<CursorTestSortField<S>, (item: T) => number | string>;
}): Promise<void> => {
	const limit = 2;
	expect(items.length).toBeGreaterThan(limit);
	expect(sorts.length).toBeGreaterThan(0);
	// Without a tie on some sort value, the id tie-break is never tested.
	const fields = Object.values<(item: T) => number | string>(sortValues);
	expect(
		fields.some(
			(sortValue) => new Set(items.map(sortValue)).size < items.length,
		),
		"no tie on any sort value",
	).toBe(true);
	for (const sort of sorts) {
		const descending = sort.startsWith("-");
		const sortValue =
			sortValues[sort.replace(/^-/, "") as CursorTestSortField<S>];
		const expected = items
			.toSorted(
				(a, b) =>
					(descending ? -1 : 1) *
					(compare(sortValue(a), sortValue(b)) ||
						compare(idToUuid(a.id), idToUuid(b.id))),
			)
			.map((item) => item.id);
		const seen: Id<P>[] = [];
		let cursor: string | undefined;
		for (let pages = 0; ; pages += 1) {
			if (pages > items.length) throw new Error(`${sort} never ended`);
			const page = await list({ cursor, limit, sort });
			// Without `count` there is no total.
			expect(page.total, sort).toBeUndefined();
			seen.push(...page.items.map((item) => item.id));
			if (page.nextCursor === null) {
				expect(page.items.length, sort).toBeLessThanOrEqual(limit);
				break;
			}
			// Every page before the last is full.
			expect(page.items.length, sort).toBe(limit);
			cursor = page.nextCursor;
		}
		expect(seen, sort).toEqual(expected);
	}
};
