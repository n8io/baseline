import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { fooDeleteCan, fooNew, fooUpdateCan } from "./foo.ts";

// The Use case tests cover the owner, a scope holder and a stranger; these keep the two scopes apart.
const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const foo = fooNew({
	actor: owner,
	id: idCreate("foo"),
	input: { name: "a" },
	now: new Date("2026-01-01T00:00:00Z"),
});
const holderOf = (scope: string): Actor => ({
	id: "other",
	kind: "user",
	scopes: [scope],
});

describe("Foo", () => {
	it("does not let foo:update delete", () => {
		expect(fooUpdateCan(foo, holderOf("foo:update"))).toBe(true);
		expect(fooDeleteCan(foo, holderOf("foo:update"))).toBe(false);
	});

	it("does not let foo:delete change", () => {
		expect(fooDeleteCan(foo, holderOf("foo:delete"))).toBe(true);
		expect(fooUpdateCan(foo, holderOf("foo:delete"))).toBe(false);
	});
});
