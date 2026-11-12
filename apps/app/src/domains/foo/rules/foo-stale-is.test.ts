import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import type { Foo } from "../models/foo.ts";
import { FOO_STALE_DAYS, fooStaleBefore, fooStaleIs } from "./foo-stale-is.ts";

const now = new Date("2026-06-01T00:00:00Z");
const fooAt = (updatedAt: Date, archivedAt: Date | null = null): Foo => ({
	archivedAt,
	createdAt: updatedAt,
	createdBy: "owner",
	id: idCreate("foo"),
	name: "a",
	updatedAt,
});
const msBefore = (ms: number) => new Date(now.getTime() - ms);

describe("fooStaleBefore", () => {
	it("is FOO_STALE_DAYS before now", () => {
		expect(fooStaleBefore(now)).toEqual(msBefore(FOO_STALE_DAYS * 86_400_000));
	});
});

describe("fooStaleIs", () => {
	it("is stale just over 30 days old", () => {
		expect(fooStaleIs(fooAt(msBefore(30 * 86_400_000 + 1)), now)).toBe(true);
	});

	it("is not stale at exactly 30 days", () => {
		expect(fooStaleIs(fooAt(msBefore(30 * 86_400_000)), now)).toBe(false);
	});

	it("is not stale when recent", () => {
		expect(fooStaleIs(fooAt(now), now)).toBe(false);
	});

	it("is not stale when already archived", () => {
		expect(fooStaleIs(fooAt(msBefore(90 * 86_400_000), now), now)).toBe(false);
	});
});
