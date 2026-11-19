import type { Actor } from "@n8io/baseline-authn";
import { type CacheStore, cacheStoreMemoryCreate } from "@n8io/baseline-cache";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { type Clock, clockMemoryCreate } from "../../../clock.ts";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../use-cases.ts";
import { FooNotFoundError } from "../domain/errors.ts";

// The read-through in fooGet and the clears after a change; the cache piece owns this file.
const actor: Actor = { id: "u1", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

// The context on a memory cache store that counts the gets it answers and the sets it is given.
const setup = async ({ clock }: { clock?: Clock | null } = {}) => {
	const store = cacheStoreMemoryCreate();
	const counts = { hits: 0, sets: 0 };
	const cacheStore: CacheStore = {
		delete: (key) => store.delete(key),
		get: async (key) => {
			const json = await store.get(key);
			if (json !== undefined) counts.hits++;
			return json;
		},
		set: (entry) => {
			counts.sets++;
			return store.set(entry);
		},
	};
	const { useCases } = contextsCreate({
		...connections,
		cacheStore,
		clock: clock ?? connections.clock,
	}).fooContext;
	const created = await useCases.fooCreate(actor, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { counts, foo: created.value, useCases };
};

describe("foo cache", () => {
	it("reads the foo, then serves the second get from the cache with its dates intact", async () => {
		const { counts, foo, useCases } = await setup();

		const first = await useCases.fooGet(actor, { fooId: foo.id });
		const second = await useCases.fooGet(actor, { fooId: foo.id });

		expect(first).toEqual({ ok: true, value: foo });
		expect(second).toEqual(first);
		expect(counts).toEqual({ hits: 1, sets: 1 });
	});

	// aggregate-create-start: schedule
	it("serves an archived foo from the cache with its archive date intact", async () => {
		const clock = clockMemoryCreate(new Date("2020-01-01T00:00:00Z"));
		const { counts, foo, useCases } = await setup({ clock });
		clock.set(new Date("2026-06-01T00:00:00Z"));
		await useCases.fooStaleArchive(actor);

		const first = await useCases.fooGet(actor, { fooId: foo.id });
		const second = await useCases.fooGet(actor, { fooId: foo.id });

		expect(first).toMatchObject({
			ok: true,
			value: { archivedAt: new Date("2026-06-01T00:00:00Z") },
		});
		expect(second).toEqual(first);
		// One set: the second get parsed what the first stored instead of reading and storing again.
		expect(counts.sets).toBe(1);
	});
	// aggregate-create-end: schedule

	it("reads the change after an update and nothing after a delete", async () => {
		const { foo, useCases } = await setup();
		await useCases.fooGet(actor, { fooId: foo.id });

		await useCases.fooUpdate(actor, { fooId: foo.id, name: "beta" });
		expect(await useCases.fooGet(actor, { fooId: foo.id })).toMatchObject({
			ok: true,
			value: { name: "beta" },
		});

		await useCases.fooDelete(actor, { fooId: foo.id });
		expect(await useCases.fooGet(actor, { fooId: foo.id })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
	});

	it("still reads, updates and deletes the foo when the cache store is down", async () => {
		const down = async (): Promise<never> => {
			throw new Error("Store is down");
		};
		const { useCases } = contextsCreate({
			...connections,
			cacheStore: { delete: down, get: down, set: down },
		}).fooContext;
		const created = await useCases.fooCreate(actor, { name: "alpha" });
		if (!created.ok) throw created.error;
		const foo = created.value;

		expect(await useCases.fooGet(actor, { fooId: foo.id })).toEqual({
			ok: true,
			value: foo,
		});
		expect(
			await useCases.fooUpdate(actor, { fooId: foo.id, name: "beta" }),
		).toMatchObject({ ok: true, value: { name: "beta" } });
		expect(await useCases.fooDelete(actor, { fooId: foo.id })).toEqual({
			ok: true,
			value: undefined,
		});
	});
});
