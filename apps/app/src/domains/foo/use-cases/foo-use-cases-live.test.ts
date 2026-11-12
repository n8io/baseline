import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import type { FooPorts } from "../ports.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooUseCasesCreate } from "./foo-use-cases.ts";

// The live updates each use case sends after commit; the live piece owns this file.
const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

type FooLiveUpdate = Parameters<FooPorts["fooLiveUpdates"]["send"]>[0];

const setup = async () => {
	const { ports } = fooPortsMemoryCreate();
	const sent: FooLiveUpdate[] = [];
	const useCases = fooUseCasesCreate({
		...ports,
		fooLiveUpdates: {
			send: async (update) => {
				sent.push(update);
			},
		},
	});
	const created = await useCases.fooCreate(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	await useCases.fooCreate(owner, { name: "beta" });
	return { foo: created.value, sent, useCases };
};

describe("foo live updates", () => {
	it("sends foo.updated after a rename and foo.deleted after a delete", async () => {
		const { foo, sent, useCases } = await setup();

		await useCases.fooUpdate(owner, { fooId: foo.id, name: "gamma" });
		await useCases.fooDelete(owner, { fooId: foo.id });

		expect(sent).toEqual([
			{ id: foo.id, type: "foo.updated" },
			{ id: foo.id, type: "foo.deleted" },
		]);
	});

	it("sends nothing when the change fails", async () => {
		const { foo, sent, useCases } = await setup();

		await useCases.fooUpdate(stranger, { fooId: foo.id, name: "gamma" });
		await useCases.fooUpdate(owner, { fooId: foo.id, name: "beta" });
		await useCases.fooUpdate(owner, { fooId: idCreate("foo"), name: "gamma" });
		await useCases.fooDelete(stranger, { fooId: foo.id });
		await useCases.fooDelete(owner, { fooId: idCreate("foo") });

		expect(sent).toEqual([]);
	});
});
