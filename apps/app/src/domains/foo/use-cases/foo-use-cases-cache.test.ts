import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { fooCacheCreate } from "../spi/foo-cache.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooUseCasesCreate } from "./foo-use-cases.ts";

// The read-through in fooGet and the clears after a change; the cache piece owns this file.
const actor: Actor = { id: "u1", kind: "user", scopes: [] };

const setup = async () => {
	const { ports, state } = fooPortsMemoryCreate();
	const useCases = fooUseCasesCreate(ports);
	const created = await useCases.fooCreate(actor, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { foo: created.value, ports, state, useCases };
};

describe("foo cache", () => {
	it("reads the foo, then serves the second get from the cache", async () => {
		const { foo, state, useCases } = await setup();

		const first = await useCases.fooGet(actor, { fooId: foo.id });
		state.foos.delete(foo.id);
		const second = await useCases.fooGet(actor, { fooId: foo.id });

		expect(first).toEqual({ ok: true, value: foo });
		expect(second).toEqual(first);
	});

	it("clears the cached foo after an update and after a delete", async () => {
		const { foo, ports, useCases } = await setup();
		await useCases.fooGet(actor, { fooId: foo.id });

		await useCases.fooUpdate(actor, { fooId: foo.id, name: "beta" });
		expect(await ports.fooCache.get(foo.id)).toBeUndefined();

		await useCases.fooGet(actor, { fooId: foo.id });
		await useCases.fooDelete(actor, { fooId: foo.id });
		expect(await ports.fooCache.get(foo.id)).toBeUndefined();
	});

	it("still reads, updates and deletes the foo when the cache store is down", async () => {
		const down = async (): Promise<never> => {
			throw new Error("Store is down");
		};
		const { ports } = fooPortsMemoryCreate();
		const useCases = fooUseCasesCreate({
			...ports,
			fooCache: fooCacheCreate({ delete: down, get: down, set: down }),
		});
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
