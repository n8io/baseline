import type { Id } from "@n8io/baseline-id";

// A list page's position: the sort value and id of its last item, as base64url JSON. Every
// repository adapter of a Domain, memory or Postgres, uses it, so a cursor from one reads the
// same in another.
export type Cursor<P extends string> = { k: string; id: Id<P> };

export const cursorEncode = <P extends string>(cursor: Cursor<P>): string =>
	Buffer.from(JSON.stringify(cursor)).toString("base64url");

// A cursor that does not decode, or whose id has another prefix, reads as none, so a mangled
// link shows the first page.
export const cursorDecode = <P extends string>(
	cursor: string,
	prefix: P,
): Cursor<P> | undefined => {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString(),
		);
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const { id, k } = parsed as Record<string, unknown>;
		return typeof k === "string" &&
			typeof id === "string" &&
			id.startsWith(`${prefix}_`)
			? { id: id as Id<P>, k }
			: undefined;
	} catch {
		return undefined;
	}
};
