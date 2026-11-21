import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { clockMemoryCreate } from "../../../../clock.ts";
import { connectionsOpen } from "../../../../connections.ts";
import { contextsCreate } from "../../../../contexts.ts";
import type { FooUseCases } from "../../application/foo-use-cases.ts";
import { FooListInput } from "../../domain/foo.ts";
import { fooSeed } from "./foo-seed.ts";

const actor: Actor = { id: "dev-seed", kind: "client", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

// The seed on the context's Use cases, as its `seeds` entry runs it for the seed command. A
// context's `seeds` holds one per Model, so the test calls this Model's own.
const setup = () => {
	const clock = clockMemoryCreate();
	const { useCases } = contextsCreate({ ...connections, clock }).fooContext;
	const seed = () => fooSeed(useCases, actor);
	return { clock, seed, useCases };
};

// Every foo's name, archived or not, sorted.
const namesOf = async (useCases: FooUseCases) => {
	const names: string[] = [];
	for (const archived of [false, true]) {
		const list = await useCases.fooList(
			actor,
			FooListInput.parse({ archived, limit: 100 }),
		);
		if (!list.ok) throw list.error;
		names.push(...list.value.items.map((foo) => foo.name));
	}
	return names.sort();
};

describe("fooSeed", () => {
	it("creates Alpha, Beta and Gamma as the given actor and returns them", async () => {
		const { seed, useCases } = setup();

		const seeded = await seed();

		expect(seeded.map((foo) => foo.name)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(await namesOf(useCases)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(seeded.every((foo) => foo.createdBy === "dev-seed")).toBe(true);
	});

	it("tops up a half-seeded database and returns the existing rows as they are", async () => {
		const { seed, useCases } = setup();
		const beta = await useCases.fooCreate(
			{ ...actor, id: "someone-else" },
			{ name: "Beta" },
		);
		if (!beta.ok) throw beta.error;

		const seeded = await seed();

		expect(seeded.map((foo) => foo.name)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(seeded[1]).toEqual(beta.value);
		expect(await namesOf(useCases)).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	it("changes nothing in a seeded database and returns the same foos", async () => {
		const { seed, useCases } = setup();
		const first = await seed();

		const second = await seed();

		expect(second).toEqual(first);
		expect(await namesOf(useCases)).toEqual(["Alpha", "Beta", "Gamma"]);
	});

	// model-create-start: schedule
	it("returns an archived foo it finds instead of failing", async () => {
		const { clock, seed, useCases } = setup();
		clock.set(new Date("2020-01-01T00:00:00Z"));
		await useCases.fooCreate(actor, { name: "Alpha" });
		clock.set(new Date("2026-06-01T00:00:00Z"));
		await useCases.fooStaleArchive(actor);

		const seeded = await seed();

		expect(seeded[0]?.archivedAt).toEqual(new Date("2026-06-01T00:00:00Z"));
		expect(await namesOf(useCases)).toEqual(["Alpha", "Beta", "Gamma"]);
	});
	// model-create-end: schedule

	it("keeps other foos and the three it ensured when the database has more", async () => {
		const { seed, useCases } = setup();
		await useCases.fooCreate(actor, { name: "Mine" });

		const seeded = await seed();

		expect(seeded.map((foo) => foo.name)).toEqual(["Alpha", "Beta", "Gamma"]);
		expect(await namesOf(useCases)).toEqual(["Alpha", "Beta", "Gamma", "Mine"]);
	});

	it("finds a taken name on a later page of a long list", async () => {
		const { clock, seed, useCases } = setup();
		const first = await seed();
		// Newer foos list first, so the three examples now sit on the second page.
		for (let n = 0; n < 120; n++) {
			clock.advance(1000);
			await useCases.fooCreate(actor, { name: `Other ${n}` });
		}

		const second = await seed();

		expect(second).toEqual(first);
		expect(
			await useCases.fooList(actor, FooListInput.parse({ count: true })),
		).toMatchObject({ ok: true, value: { total: 123 } });
	});
});
