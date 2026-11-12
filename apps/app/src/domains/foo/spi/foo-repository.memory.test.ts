import { idCreate } from "@n8io/baseline-id";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "./foo-ports.memory.ts";
import { fooRepositoryContract } from "./foo-repository.contract.ts";

describe("fooRepositoryMemoryCreate", () => {
	fooRepositoryContract(async () => fooPortsMemoryCreate().ports);

	// piece-start: queue
	it("records events only when the transaction commits", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const fooId = idCreate("foo");
		await expect(
			ports.fooTransaction(async ({ fooEvents }) => {
				await fooEvents.publish("foo.deleted", { fooId });
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(state.published).toEqual([]);
		await ports.fooTransaction(async ({ fooEvents }) => {
			await fooEvents.publish("foo.created", { fooId });
			return ok(undefined);
		});
		expect(state.published).toEqual([{ data: { fooId }, name: "foo.created" }]);
	});
	// piece-end: queue
});
