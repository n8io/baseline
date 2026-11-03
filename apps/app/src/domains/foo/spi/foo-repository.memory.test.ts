import { idCreate } from "@n8io/baseline-id";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooCursorDecode } from "./foo-cursor.ts";
import { fooPortsMemory } from "./foo-ports.memory.ts";
import { fooRepositoryContract } from "./foo-repository.contract.ts";

describe("fooRepositoryMemory", () => {
	fooRepositoryContract(async () => fooPortsMemory().ports);

	it("records events only when the transaction commits", async () => {
		const { ports, published } = fooPortsMemory();
		const fooId = idCreate("foo");
		await expect(
			ports.fooTransaction(async ({ fooEvents }) => {
				await fooEvents.publish("foo.deleted", { fooId });
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(published).toEqual([]);
		await ports.fooTransaction(async ({ fooEvents }) => {
			await fooEvents.publish("foo.created", { fooId });
			return ok(undefined);
		});
		expect(published).toEqual([{ data: { fooId }, name: "foo.created" }]);
	});

	it("reads a cursor that does not decode as none", () => {
		expect(fooCursorDecode("not-a-cursor")).toBeUndefined();
		expect(
			fooCursorDecode(Buffer.from('{"k":1,"id":"x"}').toString("base64url")),
		).toBeUndefined();
	});
});
