import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { clockMemoryCreate } from "../../../clock.ts";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";
import { FooNotFoundError } from "../domain/errors.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

const setup = () => {
	const clock = clockMemoryCreate();
	const { useCases } = contextsCreate({ ...connections, clock }).fooContext;
	return { clock, useCases };
};

describe("barList", () => {
	it("lists a foo's bars oldest first, and only that foo's", async () => {
		const { clock, useCases } = setup();
		const [alpha, beta] = await Promise.all(
			["alpha", "beta"].map(async (name) => {
				const created = await useCases.fooCreate(owner, { name });
				if (!created.ok) throw created.error;
				return created.value;
			}),
		);
		if (!alpha || !beta) throw new Error("setup");
		for (const text of ["one", "two"]) {
			await useCases.barCreate(owner, { fooId: alpha.id, text });
			clock.advance(1000);
		}
		await useCases.barCreate(owner, { fooId: beta.id, text: "other" });

		const result = await useCases.barList(owner, { fooId: alpha.id });

		expect(result.ok && result.value.map((bar) => bar.text)).toEqual([
			"one",
			"two",
		]);
	});

	it("answers an empty list for a foo with no bars", async () => {
		const { useCases } = setup();
		const created = await useCases.fooCreate(owner, { name: "alpha" });
		if (!created.ok) throw created.error;

		expect(await useCases.barList(owner, { fooId: created.value.id })).toEqual(
			ok([]),
		);
	});

	it("returns FooNotFoundError for a foo that does not exist", async () => {
		const { useCases } = setup();

		expect(await useCases.barList(owner, { fooId: idCreate("foo") })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
	});
});
