import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooUseCasesCreate } from "./foo-use-cases.ts";

// The Events each use case publishes; the queue piece owns this file.
const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

const setup = () => {
	const { ports, state } = fooPortsMemoryCreate();
	return { state, useCases: fooUseCasesCreate(ports) };
};

describe("foo Events", () => {
	it("publishes foo.created on create and foo.deleted on delete", async () => {
		const { state, useCases } = setup();
		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;
		const fooId = created.value.id;

		await useCases.fooDelete(owner, { fooId });

		expect(state.published).toEqual([
			{ data: { fooId }, name: "foo.created" },
			{ data: { fooId }, name: "foo.deleted" },
		]);
	});

	it("publishes nothing for a taken name, a forbidden delete or an unknown id", async () => {
		const { state, useCases } = setup();
		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;
		state.published.length = 0;

		await useCases.fooCreate(owner, { name: "alpha" });
		await useCases.fooDelete(stranger, { fooId: created.value.id });
		await useCases.fooDelete(owner, { fooId: idCreate("foo") });

		expect(state.published).toEqual([]);
	});
});
