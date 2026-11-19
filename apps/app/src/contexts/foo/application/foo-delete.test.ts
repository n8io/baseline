import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../adapters/outbound/foo-ports.memory.ts";
import { FooForbiddenError, FooNotFoundError } from "../domain/errors.ts";
import { barCreate } from "./bar-create.ts";
import { fooCreate } from "./foo-create.ts";
import { fooDelete } from "./foo-delete.ts";
import { fooGet } from "./foo-get.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

const setup = async () => {
	const memory = fooPortsMemoryCreate();
	const created = await fooCreate(memory.ports)(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { ...memory, foo: created.value };
};

describe("fooDelete", () => {
	it("lets the owner delete, and the next get finds nothing", async () => {
		const { ports, state, foo } = await setup();
		const get = fooGet(ports);
		await get(owner, { fooId: foo.id });

		const result = await fooDelete(ports)(owner, { fooId: foo.id });

		expect(result).toEqual({ ok: true, value: undefined });
		expect(state.foos.has(foo.id)).toBe(false);
		expect(await get(owner, { fooId: foo.id })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
	});

	it("forbids a stranger and changes nothing", async () => {
		const { ports, state, foo } = await setup();
		const result = await fooDelete(ports)(stranger, { fooId: foo.id });

		expect(result).toEqual(err(expect.any(FooForbiddenError)));
		expect(state.foos.get(foo.id)).toEqual(foo);
	});

	it("lets a holder of foo:delete delete", async () => {
		const { ports, state, foo } = await setup();
		const result = await fooDelete(ports)(
			{ ...stranger, scopes: ["foo:delete"] },
			{ fooId: foo.id },
		);

		expect(result.ok).toBe(true);
		expect(state.foos.has(foo.id)).toBe(false);
	});

	it("deletes and publishes once when deleted twice (memory transactions run one at a time)", async () => {
		const { ports, state, foo } = await setup();
		const results = await Promise.all([
			fooDelete(ports)(owner, { fooId: foo.id }),
			fooDelete(ports)(owner, { fooId: foo.id }),
		]);

		expect(results).toEqual([
			{ ok: true, value: undefined },
			err(new FooNotFoundError(foo.id)),
		]);
		expect(state.foos.has(foo.id)).toBe(false);
		// piece-start: queue
		expect(
			state.published.filter((event) => event.name === "foo.deleted"),
		).toEqual([{ data: { fooId: foo.id }, key: foo.id, name: "foo.deleted" }]);
		// piece-end: queue
	});

	it("deletes the foo's bars with it and leaves other foos' bars", async () => {
		const { ports, state, foo } = await setup();
		const other = await fooCreate(ports)(owner, { name: "beta" });
		if (!other.ok) throw other.error;
		await barCreate(ports)(owner, { fooId: foo.id, text: "gone" });
		const kept = await barCreate(ports)(owner, {
			fooId: other.value.id,
			text: "kept",
		});

		await fooDelete(ports)(owner, { fooId: foo.id });

		expect([...state.bars.values()]).toEqual([kept.ok && kept.value]);
	});

	it("keeps the bars when the delete is forbidden", async () => {
		const { ports, state, foo } = await setup();
		await barCreate(ports)(owner, { fooId: foo.id, text: "stays" });

		await fooDelete(ports)(stranger, { fooId: foo.id });

		expect(state.bars.size).toBe(1);
	});

	it("returns FooNotFoundError for an unknown id", async () => {
		const { ports } = await setup();
		const result = await fooDelete(ports)(owner, { fooId: idCreate("foo") });

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});
});
