import type { Actor } from "@n8io/baseline-authn";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../adapters/outbound/foo-ports.memory.ts";
import { FooNameTakenError } from "../domain/errors.ts";
import { fooCreate } from "./foo-create.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };

describe("fooCreate", () => {
	it("creates a foo owned by the actor", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const result = await fooCreate(ports)(actor, { name: "alpha" });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value).toMatchObject({
			archivedAt: null,
			createdBy: "u1",
			name: "alpha",
		});
		expect(state.foos.get(result.value.id)).toEqual(result.value);
	});

	it("returns FooNameTakenError for a taken name", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const create = fooCreate(ports);
		await create(actor, { name: "alpha" });

		const result = await create(actor, { name: "alpha" });

		expect(result).toEqual(err(expect.any(FooNameTakenError)));
		expect(state.foos.size).toBe(1);
	});
});
