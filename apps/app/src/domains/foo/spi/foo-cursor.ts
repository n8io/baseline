import type { Id } from "@n8io/baseline-id";

// A list page's position: the sort value and id of its last item, as base64url JSON. Both
// repository adapters use it, so a cursor from one reads the same in the other.
export type FooCursor = { k: string; id: Id<"foo"> };

export const fooCursorEncode = (cursor: FooCursor): string =>
	Buffer.from(JSON.stringify(cursor)).toString("base64url");

// A cursor that does not decode reads as none, so a mangled link shows the first page.
export const fooCursorDecode = (cursor: string): FooCursor | undefined => {
	try {
		const parsed: unknown = JSON.parse(
			Buffer.from(cursor, "base64url").toString(),
		);
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const { id, k } = parsed as Record<string, unknown>;
		return typeof k === "string" &&
			typeof id === "string" &&
			id.startsWith("foo_")
			? { id: id as Id<"foo">, k }
			: undefined;
	} catch {
		return undefined;
	}
};
