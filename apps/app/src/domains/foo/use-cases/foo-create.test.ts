import type { Actor } from "@n8io/baseline-authn";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { FooNameTakenError } from "../foo-errors.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooCreate } from "./foo-create.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };

describe("fooCreate", () => {
	it("creates a foo owned by the actor and publishes foo.created", async () => {
		const {
			ports,
			// piece-start: queue
			published,
			// piece-end: queue
			state,
		} = fooPortsMemoryCreate();
		const result = await fooCreate(ports)(actor, { name: "alpha" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({
			archivedAt: null,
			createdBy: "u1",
			name: "alpha",
		});
		expect(state.foos.get(result.value.id)).toEqual(result.value);
		// piece-start: queue
		expect(published).toEqual([
			{ data: { fooId: result.value.id }, name: "foo.created" },
		]);
		// piece-end: queue
	});

	it("returns FooNameTakenError and publishes nothing for a taken name", async () => {
		const {
			ports,
			// piece-start: queue
			published,
			// piece-end: queue
			state,
		} = fooPortsMemoryCreate();
		const create = fooCreate(ports);
		await create(actor, { name: "alpha" });
		// piece-start: queue
		published.length = 0;
		// piece-end: queue

		const result = await create(actor, { name: "alpha" });

		expect(result).toEqual(err(expect.any(FooNameTakenError)));
		expect(state.foos.size).toBe(1);
		// piece-start: queue
		expect(published).toEqual([]);
		// piece-end: queue
	});
});
