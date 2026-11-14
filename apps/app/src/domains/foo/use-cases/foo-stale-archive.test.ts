import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import type { Foo } from "../models/foo.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooStaleArchive } from "./foo-stale-archive.ts";

const actor: Actor = { id: "system", kind: "client", scopes: [] };
const now = new Date("2026-06-01T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

const fooAt = ({
	archivedAt,
	name,
	updatedAt,
}: {
	archivedAt: Date | null;
	name: string;
	updatedAt: Date;
}): Foo => ({
	archivedAt,
	createdAt: updatedAt,
	createdBy: "owner",
	id: idCreate("foo"),
	name,
	updatedAt,
});

describe("fooStaleArchive", () => {
	it("archives only unarchived foos older than 30 days and returns the count", async () => {
		const { clock, ports, state } = fooPortsMemoryCreate();
		clock.set(now);
		const old = fooAt({
			name: "old",
			updatedAt: daysAgo(31),
			archivedAt: null,
		});
		const older = fooAt({
			name: "older",
			updatedAt: daysAgo(90),
			archivedAt: null,
		});
		const fresh = fooAt({
			name: "fresh",
			updatedAt: daysAgo(29),
			archivedAt: null,
		});
		const boundary = fooAt({
			name: "boundary",
			updatedAt: daysAgo(30),
			archivedAt: null,
		});
		const alreadyArchived = fooAt({
			name: "done",
			updatedAt: daysAgo(60),
			archivedAt: daysAgo(10),
		});
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
