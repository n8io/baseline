import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { cursorDecode, cursorEncode } from "./cursor.ts";

const encoded = (value: unknown): string =>
	Buffer.from(JSON.stringify(value)).toString("base64url");

describe("cursor", () => {
	it("decodes what it encodes", () => {
		const cursor = { id: idCreate("invoice"), k: "2026-11-03T00:00:00.000Z" };

		expect(cursorDecode(cursorEncode(cursor), "invoice")).toEqual(cursor);
	});

	it("reads a cursor that does not decode as none", () => {
		expect(cursorDecode("not-a-cursor", "invoice")).toBeUndefined();
		expect(cursorDecode(encoded(null), "invoice")).toBeUndefined();
		expect(
			cursorDecode(encoded({ id: idCreate("invoice"), k: 1 }), "invoice"),
		).toBeUndefined();
		expect(cursorDecode(encoded({ id: "x", k: 1 }), "invoice")).toBeUndefined();
	});

	it("reads an id with another prefix as none", () => {
		const cursor = encoded({ id: idCreate("customer"), k: "a" });

		expect(cursorDecode(cursor, "invoice")).toBeUndefined();
		expect(
			cursorDecode(encoded({ id: "invoices_x", k: "a" }), "invoice"),
		).toBeUndefined();
	});
});
