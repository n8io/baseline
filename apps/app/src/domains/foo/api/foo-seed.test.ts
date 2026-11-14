import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { fooUseCasesCreate } from "../index.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooSeed } from "./foo-seed.ts";

const actor: Actor = { id: "dev-seed", kind: "client", scopes: [] };

const namesOf = (state: { foos: Map<string, { name: string }> }) =>
	[...state.foos.values()].map((foo) => foo.name).sort();

describe("fooSeed", () => {
	it("creates Alpha, Beta and Gamma as the given actor and returns them", async () => {
		const { ports, state } = fooPortsMemoryCreate();

		const seeded = await fooSeed(fooUseCasesCreate(ports), actor);

		expect(seeded.map((foo) => foo.name)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(seeded).toEqual([...state.foos.values()]);
		expect(seeded.every((foo) => foo.createdBy === "dev-seed")).toBe(true);
	});

	it("tops up a half-seeded database and returns the existing rows as they are", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const useCases = fooUseCasesCreate(ports);
		const beta = await useCases.fooCreate(
			{ ...actor, id: "someone-else" },
			{ name: "Beta" },
		);
		if (!beta.ok) throw beta.error;

		const seeded = await fooSeed(useCases, actor);

		expect(seeded.map((foo) => foo.name)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(seeded[1]).toEqual(beta.value);
		expect(namesOf(state)).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("changes nothing in a seeded database and returns the same foos", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const useCases = fooUseCasesCreate(ports);
		const first = await fooSeed(useCases, actor);

		const second = await fooSeed(useCases, actor);

		expect(second).toEqual(first);
		expect(namesOf(state)).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("returns an archived foo it finds instead of failing", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const useCases = fooUseCasesCreate(ports);
		const alpha = await useCases.fooCreate(actor, { name: "Alpha" });
		if (!alpha.ok) throw alpha.error;
		state.foos.set(alpha.value.id, {
			...alpha.value,
			archivedAt: new Date(0),
		});

		const seeded = await fooSeed(useCases, actor);

		expect(seeded[0]?.archivedAt).toEqual(new Date(0));
		expect(namesOf(state)).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("keeps other foos and the three it ensured when the database has more", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const useCases = fooUseCasesCreate(ports);
		await useCases.fooCreate(actor, { name: "Mine" });

		const seeded = await fooSeed(useCases, actor);

		expect(seeded.map((foo) => foo.name)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(namesOf(state)).toEqual(["Alpha", "Beta", "Gamma", "Mine"]);
	});

	it("finds a taken name on a later page of a long list", async () => {
		const { clock, ports, state } = fooPortsMemoryCreate();
		const useCases = fooUseCasesCreate(ports);
		const first = await fooSeed(useCases, actor);
		// Newer foos list first, so the three examples now sit on the second page.
		for (let n = 0; n < 120; n++) {
			clock.advance(1000);
			await useCases.fooCreate(actor, { name: `Other ${n}` });
		}

		const second = await fooSeed(useCases, actor);

		expect(second).toEqual(first);
		expect(state.foos.size).toBe(123);
	});
});
