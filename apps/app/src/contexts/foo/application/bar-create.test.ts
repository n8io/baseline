import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { clockMemoryCreate } from "../../../clock.ts";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../use-cases.ts";
import { FooForbiddenError, FooNotFoundError } from "../domain/errors.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

const setup = async () => {
	const clock = clockMemoryCreate();
	const { useCases } = contextsCreate({ ...connections, clock }).fooContext;
	const created = await useCases.fooCreate(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { clock, foo: created.value, useCases };
};

describe("barCreate", () => {
	it("adds a bar to the owner's foo, and the foo's list shows it", async () => {
		const { clock, foo, useCases } = await setup();

		const result = await useCases.barCreate(owner, {
			fooId: foo.id,
			text: "first",
		});

		const bar = {
			createdAt: clock.now(),
			createdBy: owner.id,
			fooId: foo.id,
			id: expect.stringMatching(/^bar_/),
			text: "first",
		};
		expect(result).toEqual(ok(bar));
		expect(await useCases.barList(owner, { fooId: foo.id })).toEqual(ok([bar]));
	});

	it("lets a holder of foo:update add one", async () => {
		const { foo, useCases } = await setup();
		const result = await useCases.barCreate(
			{ ...stranger, scopes: ["foo:update"] },
			{ fooId: foo.id, text: "first" },
		);

		expect(result.ok).toBe(true);
	});

	it("forbids a stranger and adds nothing", async () => {
		const { foo, useCases } = await setup();
		const result = await useCases.barCreate(stranger, {
			fooId: foo.id,
			text: "first",
		});

		expect(result).toEqual(err(expect.any(FooForbiddenError)));
		expect(await useCases.barList(owner, { fooId: foo.id })).toEqual(ok([]));
	});

	it("returns FooNotFoundError for a foo that does not exist", async () => {
		const { useCases } = await setup();
		const result = await useCases.barCreate(owner, {
			fooId: idCreate("foo"),
			text: "first",
		});

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});
});
