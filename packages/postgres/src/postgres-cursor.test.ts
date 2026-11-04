import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { postgresCursorDecode, postgresCursorEncode } from "./index.ts";

const encoded = (value: unknown): string =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

describe("postgresCursor", () => {
	it("decodes what it encodes", () => {
		const cursor = { id: idCreate("foo"), k: "2026-11-03T00:00:00.000Z" };

		expect(postgresCursorDecode(postgresCursorEncode(cursor), "foo")).toEqual(
			cursor,
		);
	});

	it("reads a cursor that does not decode as none", () => {
		expect(postgresCursorDecode("not-a-cursor", "foo")).toBeUndefined();
		expect(postgresCursorDecode(encoded(null), "foo")).toBeUndefined();
		expect(
			postgresCursorDecode(encoded({ id: idCreate("foo"), k: 1 }), "foo"),
		).toBeUndefined();
		expect(
			postgresCursorDecode(encoded({ id: "x", k: 1 }), "foo"),
		).toBeUndefined();
	});

	it("reads an id with another prefix as none", () => {
		const cursor = encoded({ id: idCreate("bar"), k: "a" });

		expect(postgresCursorDecode(cursor, "foo")).toBeUndefined();
		expect(
			postgresCursorDecode(encoded({ id: "foobar_x", k: "a" }), "foo"),
		).toBeUndefined();
	});
});
