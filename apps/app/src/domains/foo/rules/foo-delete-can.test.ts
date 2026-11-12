import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import type { Foo } from "../models/foo.ts";
import { fooDeleteCan } from "./foo-delete-can.ts";

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

describe("fooDeleteCan", () => {
	it("allows the owner", () => {
		expect(fooDeleteCan(foo, actor("owner"))).toBe(true);
	});

	it("allows a holder of foo:delete", () => {
		expect(fooDeleteCan(foo, actor("other", ["foo:delete"]))).toBe(true);
	});

	it("denies a stranger, including one with only foo:update", () => {
		expect(fooDeleteCan(foo, actor("other"))).toBe(false);
		expect(fooDeleteCan(foo, actor("other", ["foo:update"]))).toBe(false);
	});
});
