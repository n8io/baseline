import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Foo } from "../models/foo.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooStaleArchive } from "./foo-stale-archive.ts";

const actor: Actor = { id: "system", kind: "client", scopes: [] };
const now = new Date("2026-06-01T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

const fooAt = (
	name: string,
	updatedAt: Date,
	archivedAt: Date | null,
): Foo => ({
	archivedAt,
	createdAt: updatedAt,
	createdBy: "owner",
	id: idCreate("foo"),
	name,
	updatedAt,
});

describe("fooStaleArchive", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(now);
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("archives only unarchived foos older than 30 days and returns the count", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const old = fooAt("old", daysAgo(31), null);
		const older = fooAt("older", daysAgo(90), null);
		const fresh = fooAt("fresh", daysAgo(29), null);
		const boundary = fooAt("boundary", daysAgo(30), null);
		const alreadyArchived = fooAt("done", daysAgo(60), daysAgo(10));
		for (const foo of [old, older, fresh, boundary, alreadyArchived]) {
			state.foos.set(foo.id, foo);
		}

		const result = await fooStaleArchive(ports)(actor);

		expect(result).toEqual({ ok: true, value: 2 });
		expect(state.foos.get(old.id)?.archivedAt).toEqual(now);
		expect(state.foos.get(older.id)?.archivedAt).toEqual(now);
		expect(state.foos.get(fresh.id)?.archivedAt).toBeNull();
		expect(state.foos.get(boundary.id)?.archivedAt).toBeNull();
		expect(state.foos.get(alreadyArchived.id)?.archivedAt).toEqual(daysAgo(10));
	});

	it("returns 0 when nothing is stale", async () => {
		const { ports } = fooPortsMemoryCreate();

		expect(await fooStaleArchive(ports)(actor)).toEqual({ ok: true, value: 0 });
	});
});
