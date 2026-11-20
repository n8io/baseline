import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { clockMemoryCreate } from "../../../clock.ts";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";
import {
	FooForbiddenError,
	FooNameTakenError,
	FooNotFoundError,
} from "../domain/errors.ts";

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

describe("fooUpdate", () => {
	it("lets the owner rename, and the next get reads the new name", async () => {
		const { foo, useCases } = await setup();
		await useCases.fooGet(owner, { fooId: foo.id });

		const result = await useCases.fooUpdate(owner, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual({
			ok: true,
			value: expect.objectContaining({ id: foo.id, name: "beta" }),
		});
		expect(await useCases.fooGet(owner, { fooId: foo.id })).toEqual({
			ok: true,
			value: expect.objectContaining({ name: "beta" }),
		});
	});

	it("stamps updatedAt from the clock", async () => {
		const { clock, foo, useCases } = await setup();
		clock.advance(60_000);

		const result = await useCases.fooUpdate(owner, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual({
			ok: true,
			value: {
				...foo,
				name: "beta",
				updatedAt: new Date(foo.createdAt.getTime() + 60_000),
			},
		});
	});

	it("answers FooNotFoundError after a delete (memory transactions run one at a time)", async () => {
		const { foo, useCases } = await setup();

		const [deleted, updated] = await Promise.all([
			useCases.fooDelete(owner, { fooId: foo.id }),
			useCases.fooUpdate(owner, { fooId: foo.id, name: "beta" }),
		]);

		expect(deleted.ok).toBe(true);
		expect(updated).toEqual(err(new FooNotFoundError(foo.id)));
	});

	it("forbids a stranger and a holder of foo:delete, and changes nothing", async () => {
		const { foo, useCases } = await setup();

		for (const actor of [stranger, { ...stranger, scopes: ["foo:delete"] }]) {
			expect(
				await useCases.fooUpdate(actor, { fooId: foo.id, name: "beta" }),
			).toEqual(err(expect.any(FooForbiddenError)));
		}
		expect(await useCases.fooGet(owner, { fooId: foo.id })).toEqual({
			ok: true,
			value: foo,
		});
	});

	it("lets a holder of foo:update rename", async () => {
		const { foo, useCases } = await setup();
		const result = await useCases.fooUpdate(
			{ ...stranger, scopes: ["foo:update"] },
			{ fooId: foo.id, name: "beta" },
		);

		expect(result.ok).toBe(true);
	});

	it("returns FooNotFoundError for an unknown id", async () => {
		const { useCases } = await setup();
		const result = await useCases.fooUpdate(owner, {
			fooId: idCreate("foo"),
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});

	it("returns FooNameTakenError when another foo has the name, and keeps the old name", async () => {
		const { foo, useCases } = await setup();
		await useCases.fooCreate(owner, { name: "beta" });

		const result = await useCases.fooUpdate(owner, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooNameTakenError)));
		expect(await useCases.fooGet(owner, { fooId: foo.id })).toEqual({
			ok: true,
			value: foo,
		});
	});
});
