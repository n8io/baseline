import type { Actor } from "@n8io/baseline-authn";
import type { Id } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { clockMemoryCreate } from "../../../clock.ts";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../use-cases.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const system: Actor = { id: "system", kind: "client", scopes: [] };
const now = new Date("2026-06-01T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const connections = await connectionsOpen({ role: "publisher" });

const setup = () => {
	const clock = clockMemoryCreate(now);
	const { useCases } = contextsCreate({ ...connections, clock }).fooContext;
	// A foo last changed at `at`.
	const fooAt = async (name: string, at: Date) => {
		clock.set(at);
		const created = await useCases.fooCreate(owner, { name });
		if (!created.ok) throw created.error;
		return created.value;
	};
	const archivedAt = async (fooId: Id<"foo">) => {
		const got = await useCases.fooGet(owner, { fooId });
		if (!got.ok) throw got.error;
		return got.value.archivedAt;
	};
	return { archivedAt, clock, fooAt, useCases };
};

describe("fooStaleArchive", () => {
	it("archives only unarchived foos older than 30 days and returns the count", async () => {
		const { archivedAt, clock, fooAt, useCases } = setup();
		// Archived 10 days ago, when it was already 50 days old.
		const done = await fooAt("done", daysAgo(60));
		clock.set(daysAgo(10));
		expect(await useCases.fooStaleArchive(system)).toEqual({
			ok: true,
			value: 1,
		});
		const old = await fooAt("old", daysAgo(31));
		const older = await fooAt("older", daysAgo(90));
		const fresh = await fooAt("fresh", daysAgo(29));
		const boundary = await fooAt("boundary", daysAgo(30));
		clock.set(now);

		const result = await useCases.fooStaleArchive(system);

		expect(result).toEqual({ ok: true, value: 2 });
		expect(await archivedAt(old.id)).toEqual(now);
		expect(await archivedAt(older.id)).toEqual(now);
		expect(await archivedAt(fresh.id)).toBeNull();
		expect(await archivedAt(boundary.id)).toBeNull();
		expect(await archivedAt(done.id)).toEqual(daysAgo(10));
	});

	it("returns 0 when nothing is stale", async () => {
		const { useCases } = setup();

		expect(await useCases.fooStaleArchive(system)).toEqual({
			ok: true,
			value: 0,
		});
	});
});
