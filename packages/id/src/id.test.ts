import { describe, expect, it } from "vitest";
import {
	type Id,
	idCreate,
	idFromUuid,
	idPatternCreate,
	idToUuid,
} from "./id.ts";

// Vectors from the TypeID spec's valid.yml, with a `foo` prefix where the spec has none.
const vectors: [Id<string>, string][] = [
	["foo_00000000000000000000000000", "00000000-0000-0000-0000-000000000000"],
	["foo_00000000000000000000000001", "00000000-0000-0000-0000-000000000001"],
	["foo_0000000000000000000000000a", "00000000-0000-0000-0000-00000000000a"],
	["foo_0000000000000000000000000g", "00000000-0000-0000-0000-000000000010"],
	["foo_00000000000000000000000010", "00000000-0000-0000-0000-000000000020"],
	["foo_7zzzzzzzzzzzzzzzzzzzzzzzzz", "ffffffff-ffff-ffff-ffff-ffffffffffff"],
	["prefix_01h455vb4pex5vsknk084sn02q", "01890a5d-ac96-774b-bcce-b302099a8057"],
];

describe("idCreate", () => {
	it("makes a prefixed id holding a UUIDv7 of the current time", () => {
		const before = Date.now();
		const id = idCreate("invoice_line");
		const after = Date.now();

		expect(id).toMatch(/^invoice_line_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
		const hex = idToUuid(id).replaceAll("-", "");
		const time = Number.parseInt(hex.slice(0, 12), 16);
		expect(time).toBeGreaterThanOrEqual(before);
		expect(time).toBeLessThanOrEqual(after);
		expect(hex[12]).toBe("7");
		expect(["8", "9", "a", "b"]).toContain(hex[16]);
	});

	it("makes a different id each call", () => {
		const ids = new Set(Array.from({ length: 1000 }, () => idCreate("foo")));
		expect(ids.size).toBe(1000);
	});

	it.each(["", "Foo", "foo-bar", "_foo", "foo_", "foo1", "a".repeat(64)])(
		"rejects the prefix %j",
		(prefix) => {
			expect(() => idCreate(prefix)).toThrow(TypeError);
		},
	);

	it("accepts a 63-character prefix", () => {
		expect(idCreate("a".repeat(63))).toMatch(/^a{63}_/);
	});
});

describe("idToUuid and idFromUuid", () => {
	it.each(vectors)("%s is %s", (id, uuid) => {
		expect(idToUuid(id)).toBe(uuid);
		expect(idFromUuid(id.slice(0, id.lastIndexOf("_")), uuid)).toBe(id);
	});

	it("idFromUuid accepts an uppercase UUID", () => {
		expect(idFromUuid("foo", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")).toBe(
			"foo_7zzzzzzzzzzzzzzzzzzzzzzzzz",
		);
	});

	it("round-trips a created id", () => {
		const id = idCreate("foo");
		expect(idFromUuid("foo", idToUuid(id))).toBe(id);
	});

	it.each([
		"foo_8zzzzzzzzzzzzzzzzzzzzzzzzz",
		"foo_0000000000000000000000000",
		"foo_0000000000000000000000000u",
		"foo_0000000000000000000000000A",
		"Foo_00000000000000000000000000",
		"_foo_00000000000000000000000000",
		"foo00000000000000000000000000",
	])("idToUuid rejects %s", (id) => {
		expect(() => idToUuid(id as Id<string>)).toThrow(TypeError);
	});

	it.each([
		"",
		"not-a-uuid",
		"00000000000000000000000000000000",
		"00000000-0000-0000-0000-00000000000g",
	])("idFromUuid rejects %j", (uuid) => {
		expect(() => idFromUuid("foo", uuid)).toThrow(TypeError);
	});

	it("idFromUuid rejects a bad prefix", () => {
		expect(() =>
			idFromUuid("Foo", "00000000-0000-0000-0000-000000000000"),
		).toThrow(TypeError);
	});
});

describe("idPatternCreate", () => {
	it("matches an id with its prefix", () => {
		expect(idPatternCreate("foo").test(idCreate("foo"))).toBe(true);
	});

	it.each([
		["another prefix", idCreate("bar")],
		["a longer prefix", idCreate("foo_bar")],
		["a malformed suffix", "foo_8zzzzzzzzzzzzzzzzzzzzzzzzz"],
		["a bare UUID", "01890a5d-ac96-774b-bcce-b302099a8057"],
		["an id with text after it", `${idCreate("foo")}\n`],
	])("does not match %s", (_name, value) => {
		expect(idPatternCreate("foo").test(value)).toBe(false);
	});

	it("rejects a bad prefix", () => {
		expect(() => idPatternCreate("foo-bar")).toThrow(TypeError);
	});
});
