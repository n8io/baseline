import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type Id,
	idCreate,
	idFromUuid,
	idPatternCreate,
	idToUuid,
} from "./id.ts";

const uuid = "00000000-0000-0000-0000-000000000000";

// Vitest requires an assertion in every test, and expectTypeOf makes none at run time, so each
// test also checks one value. The types are checked by `tsc --noEmit` (the Package's `check`).
describe("id types", () => {
	it("Id<P> is a template literal on its prefix", () => {
		expectTypeOf<Id<"foo">>().toEqualTypeOf<`foo_${string}`>();
		expectTypeOf<Id<"foo">>().toExtend<string>();
		expectTypeOf<Id<"foo">>().toExtend<Id<string>>();
		expect(idFromUuid("foo", uuid)).toMatch(/^foo_/);
	});

	it("an id of one prefix is not an id of another", () => {
		expectTypeOf<Id<"foo">>().not.toExtend<Id<"bar">>();
		expectTypeOf<Id<"bar">>().not.toExtend<Id<"foo">>();
		expectTypeOf<string>().not.toExtend<Id<"foo">>();
		expect(idFromUuid("bar", uuid)).not.toMatch(/^foo_/);
	});

	it("idCreate and idFromUuid keep the literal prefix", () => {
		expectTypeOf(idCreate("foo")).toEqualTypeOf<Id<"foo">>();
		expectTypeOf(idFromUuid("bar", uuid)).toEqualTypeOf<Id<"bar">>();
		expect(idCreate("foo")).toMatch(/^foo_/);
	});

	it("idToUuid takes any id and returns a string", () => {
		expectTypeOf(idToUuid).parameter(0).toEqualTypeOf<Id<string>>();
		expectTypeOf(idToUuid).returns.toBeString();
		expectTypeOf(idPatternCreate).returns.toEqualTypeOf<RegExp>();
		expect(idToUuid(idFromUuid("foo", uuid))).toBe(uuid);
	});
});
