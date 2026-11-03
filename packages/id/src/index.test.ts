import { describe, expect, test, vi } from "vitest";
import { type Id, idCreate, idFromUuid, idSchema, idToUuid } from "./index.ts";

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
	test("makes a prefixed id holding a UUIDv7 of the current time", () => {
		vi.useFakeTimers({ now: Date.UTC(2026, 10, 2, 12, 0, 0, 123) });
		const id = idCreate("invoice_line");
		vi.useRealTimers();

		expect(id).toMatch(/^invoice_line_[0-7][0-9a-hjkmnp-tv-z]{25}$/);
		const hex = idToUuid(id).replaceAll("-", "");
		expect(Number.parseInt(hex.slice(0, 12), 16)).toBe(
			Date.UTC(2026, 10, 2, 12, 0, 0, 123),
		);
		expect(hex[12]).toBe("7");
		expect(["8", "9", "a", "b"]).toContain(hex[16]);
	});

	test("makes a different id each call", () => {
		const ids = new Set(Array.from({ length: 1000 }, () => idCreate("foo")));
		expect(ids.size).toBe(1000);
	});

	test.each(["", "Foo", "foo-bar", "_foo", "foo_", "foo1", "a".repeat(64)])(
		"rejects the prefix %j",
		(prefix) => {
			expect(() => idCreate(prefix)).toThrow(TypeError);
		},
	);

	test("accepts a 63-character prefix", () => {
		expect(idCreate("a".repeat(63))).toMatch(/^a{63}_/);
	});
});

describe("idToUuid and idFromUuid", () => {
	test.each(vectors)("%s is %s", (id, uuid) => {
		expect(idToUuid(id)).toBe(uuid);
		expect(idFromUuid(id.slice(0, id.lastIndexOf("_")), uuid)).toBe(id);
	});

	test("idFromUuid accepts an uppercase UUID", () => {
		expect(idFromUuid("foo", "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF")).toBe(
			"foo_7zzzzzzzzzzzzzzzzzzzzzzzzz",
		);
	});

	test("round-trips a created id", () => {
		const id = idCreate("foo");
		expect(idFromUuid("foo", idToUuid(id))).toBe(id);
	});

	test.each([
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

	test.each([
		"",
		"not-a-uuid",
		"00000000000000000000000000000000",
		"00000000-0000-0000-0000-00000000000g",
	])("idFromUuid rejects %j", (uuid) => {
		expect(() => idFromUuid("foo", uuid)).toThrow(TypeError);
	});

	test("idFromUuid rejects a bad prefix", () => {
		expect(() =>
			idFromUuid("Foo", "00000000-0000-0000-0000-000000000000"),
		).toThrow(TypeError);
	});
});

describe("idSchema", () => {
	test("accepts an id with its prefix", () => {
		const id = idCreate("foo");
		expect(idSchema("foo").parse(id)).toBe(id);
	});

	test.each([
		["another prefix", idCreate("bar")],
		["a longer prefix", idCreate("foo_bar")],
		["a malformed suffix", "foo_8zzzzzzzzzzzzzzzzzzzzzzzzz"],
		["a bare UUID", "01890a5d-ac96-774b-bcce-b302099a8057"],
		["a number", 42],
	])("rejects %s", (_name, value) => {
		expect(idSchema("foo").safeParse(value).success).toBe(false);
	});

	test("rejects a bad prefix", () => {
		expect(() => idSchema("foo-bar")).toThrow(TypeError);
	});
});
