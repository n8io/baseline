import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooUseCasesCreate } from "./foo-use-cases.ts";

// The analytics events the use cases track after commit; the analytics piece owns this file.
const owner: Actor = { id: "owner", kind: "user", scopes: [] };

const setup = () => {
	const { ports, state } = fooPortsMemoryCreate();
	return {
		tracked: state.analyticsTracked,
		useCases: fooUseCasesCreate(ports),
	};
};

describe("foo analytics", () => {
	it("tracks foo.created with the Actor's id after commit", async () => {
		const { tracked, useCases } = setup();

		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;

		expect(tracked).toEqual([
			{
				actorId: owner.id,
				committed: true,
				fooId: created.value.id,
				name: "foo.created",
			},
		]);
	});

	it("tracks nothing when the create fails", async () => {
		const { tracked, useCases } = setup();
		await useCases.fooCreate(owner, { name: "alpha" });
		tracked.length = 0;

		await useCases.fooCreate(owner, { name: "alpha" });

		expect(tracked).toEqual([]);
	});
});
