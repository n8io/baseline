import { type Id, idToUuid } from "@n8io/baseline-id";

// What a list sorts on: text by code unit, a number, or an instant as an ISO string.
export type CursorKind = "date" | "number" | "text";

// A list page's position: the sort value and id of its last item, as base64url JSON. Every
// repository adapter of a Domain, memory or Postgres, uses it, so a cursor from one reads the
// same in another. `kind` says which sort wrote it.
export type Cursor<P extends string> = {
	id: Id<P>;
	kind: CursorKind;
	value: number | string;
};

export const cursorEncode = <P extends string>(cursor: Cursor<P>): string =>
	Buffer.from(JSON.stringify(cursor)).toString("base64url");

// A number is not range-checked: a caller sorting an integer column does that itself.
const valueIs = (kind: CursorKind, value: unknown): value is number | string =>
	kind === "number"
		? typeof value === "number" && Number.isFinite(value)
		: typeof value === "string" &&
			// Postgres refuses a NUL in text, and reads only a four-digit year as an instant: a date is
			// exactly what Date#toISOString writes for such a year.
			(kind === "text"
				? !value.includes("\0")
				: /^\d{4}-/.test(value) && new Date(value).toISOString() === value);

// A cursor that does not decode, comes from another sort (its kind differs) or whose id has
// another prefix, reads as none, so a mangled or stale link shows the first page.
export const cursorDecode = <P extends string>({
	cursor,
	kind,
	prefix,
}: {
	cursor: string;
	kind: CursorKind;
	prefix: P;
}): Cursor<P> | null => {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString(),
		);
		if (typeof parsed !== "object" || parsed === null) return null;
		const { id, kind: found, value } = parsed as Record<string, unknown>;
		if (
			found !== kind ||
			typeof id !== "string" ||
			!id.startsWith(`${prefix}_`) ||
			!valueIs(kind, value)
		) {
			return null;
		}
		// Throws on an id that is no id, which reads as none too.
		idToUuid(id as Id<P>);
		return { id: id as Id<P>, kind, value };
	} catch {
		// Bad JSON, an unparsable date and a malformed id all throw.
		return null;
	}
};

const valueOrder = (a: number | string, b: number | string): number =>
	typeof a === "string" && typeof b === "string"
		? // UTF-8 byte order, like COLLATE "C"; UTF-16 code units differ above U+FFFF.
			Buffer.compare(Buffer.from(a), Buffer.from(b))
		: a < b
			? -1
			: a > b
				? 1
				: 0;

// The memory adapter's page: the items after `after` in the order of postgresKeysetCreate (sort
// value, then id as Postgres compares it; strings by byte, like COLLATE "C"), at most
// `limit`, and the cursor of the next page or null. `items` are already filtered.
export const cursorMemoryPage = <P extends string, T extends { id: Id<P> }>({
	after,
	descending,
	items,
	kind,
	limit,
	sortValue,
}: {
	after?: Cursor<P> | null;
	descending: boolean;
	items: T[];
	kind: CursorKind;
	limit: number;
	sortValue: (item: T) => number | string;
}): { items: T[]; nextCursor: string | null } => {
	const direction = descending ? -1 : 1;
	const keyed = items.map((item) => ({
		item,
		uuid: idToUuid(item.id),
		value: sortValue(item),
	}));
	const compare = (
		a: { uuid: string; value: number | string },
		b: { uuid: string; value: number | string },
	): number =>
		direction * (valueOrder(a.value, b.value) || valueOrder(a.uuid, b.uuid));
	keyed.sort(compare);
	const afterKey = after && { uuid: idToUuid(after.id), value: after.value };
	const rest = afterKey
		? keyed.filter((row) => compare(row, afterKey) > 0)
		: keyed;
	const page = rest.slice(0, limit);
	const last = page.at(-1);
	return {
		items: page.map((row) => row.item),
		nextCursor:
			rest.length > limit && last
				? cursorEncode({ id: last.item.id, kind, value: last.value })
				: null,
	};
};
