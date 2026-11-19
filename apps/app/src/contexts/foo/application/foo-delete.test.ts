import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../use-cases.ts";
import { FooForbiddenError, FooNotFoundError } from "../domain/errors.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

const setup = async () => {
	const { useCases } = contextsCreate(connections).fooContext;
	const created = await useCases.fooCreate(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { foo: created.value, useCases };
};

describe("fooDelete", () => {
	it("lets the owner delete, and the next get finds nothing", async () => {
		const { foo, useCases } = await setup();
		await useCases.fooGet(owner, { fooId: foo.id });

		const result = await useCases.fooDelete(owner, { fooId: foo.id });

		expect(result).toEqual({ ok: true, value: undefined });
		expect(await useCases.fooGet(owner, { fooId: foo.id })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
	});

	it("forbids a stranger and a holder of foo:update, and changes nothing", async () => {
		const { foo, useCases } = await setup();

		for (const actor of [stranger, { ...stranger, scopes: ["foo:update"] }]) {
			expect(await useCases.fooDelete(actor, { fooId: foo.id })).toEqual(
				err(expect.any(FooForbiddenError)),
			);
		}
		expect(await useCases.fooGet(owner, { fooId: foo.id })).toEqual(ok(foo));
	});

	it("lets a holder of foo:delete delete", async () => {
		const { foo, useCases } = await setup();
		const result = await useCases.fooDelete(
			{ ...stranger, scopes: ["foo:delete"] },
			{ fooId: foo.id },
		);

		expect(result.ok).toBe(true);
		expect(await useCases.fooGet(owner, { fooId: foo.id })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
	});

	it("deletes once when deleted twice (memory transactions run one at a time)", async () => {
		const { foo, useCases } = await setup();
		const results = await Promise.all([
			useCases.fooDelete(owner, { fooId: foo.id }),
			useCases.fooDelete(owner, { fooId: foo.id }),
		]);

		expect(results).toEqual([
			{ ok: true, value: undefined },
			err(new FooNotFoundError(foo.id)),
		]);
	});

	it("deletes the foo's bars with it and leaves other foos' bars", async () => {
		const { foo, useCases } = await setup();
		const other = await useCases.fooCreate(owner, { name: "beta" });
		if (!other.ok) throw other.error;
		await useCases.barCreate(owner, { fooId: foo.id, text: "gone" });
		const kept = await useCases.barCreate(owner, {
			fooId: other.value.id,
			text: "kept",
		});

		await useCases.fooDelete(owner, { fooId: foo.id });

		expect(await useCases.barList(owner, { fooId: foo.id })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
		expect(await useCases.barList(owner, { fooId: other.value.id })).toEqual(
			ok([kept.ok && kept.value]),
		);
	});

	it("keeps the bars when the delete is forbidden", async () => {
		const { foo, useCases } = await setup();
		const bar = await useCases.barCreate(owner, {
			fooId: foo.id,
			text: "stays",
		});

		await useCases.fooDelete(stranger, { fooId: foo.id });

		expect(await useCases.barList(owner, { fooId: foo.id })).toEqual(
			ok([bar.ok && bar.value]),
		);
	});

	it("returns FooNotFoundError for an unknown id", async () => {
		const { useCases } = await setup();
		const result = await useCases.fooDelete(owner, { fooId: idCreate("foo") });

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});
});
