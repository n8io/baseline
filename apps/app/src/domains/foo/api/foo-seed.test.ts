import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { fooUseCasesCreate } from "../index.ts";
import { fooPortsMemory } from "../spi/foo-ports.memory.ts";
import { fooSeed } from "./foo-seed.ts";

const actor: Actor = { id: "dev-seed", kind: "client", scopes: [] };

describe("fooSeed", () => {
	it("creates Alpha, Beta and Gamma as the given actor", async () => {
		const { ports, state } = fooPortsMemory();
		await fooSeed(fooUseCasesCreate(ports), actor);

		const foos = [...state.foos.values()];
		expect(foos.map((foo) => foo.name)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(foos.every((foo) => foo.createdBy === "dev-seed")).toBe(true);
	});

	it("skips when any foo exists, so a database is seeded once", async () => {
		const { ports, state } = fooPortsMemory();
		const useCases = fooUseCasesCreate(ports);
		await useCases.fooCreate(actor, { name: "Mine" });

		await fooSeed(useCases, actor);
		await fooSeed(useCases, actor);

		expect([...state.foos.values()].map((foo) => foo.name)).toEqual(["Mine"]);
	});
});
