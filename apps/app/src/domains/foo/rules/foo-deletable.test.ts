import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import type { Foo } from "../models/foo.ts";
import { fooDeletable } from "./foo-deletable.ts";

const now = new Date("2026-01-01T00:00:00Z");
const foo: Foo = {
	archivedAt: null,
	createdAt: now,
	createdBy: "owner",
	id: idCreate("foo"),
	name: "a",
	updatedAt: now,
};
const actor = (id: string, scopes: string[] = []): Actor => ({
	id,
	kind: "user",
	scopes,
});

describe("fooDeletable", () => {
	it("allows the owner", () => {
		expect(fooDeletable(foo, actor("owner"))).toBe(true);
	});

	it("allows a holder of foo:delete", () => {
		expect(fooDeletable(foo, actor("other", ["foo:delete"]))).toBe(true);
	});

	it("denies a stranger, including one with only foo:update", () => {
		expect(fooDeletable(foo, actor("other"))).toBe(false);
		expect(fooDeletable(foo, actor("other", ["foo:update"]))).toBe(false);
	});
});
