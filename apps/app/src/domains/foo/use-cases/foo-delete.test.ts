import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { FooForbiddenError, FooNotFoundError } from "../foo-errors.ts";
import { fooPortsMemory } from "../spi/foo-ports.memory.ts";
import { fooCreate } from "./foo-create.ts";
import { fooDelete } from "./foo-delete.ts";
import { fooGet } from "./foo-get.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

const setup = async () => {
	const memory = fooPortsMemory();
	const created = await fooCreate(memory.ports)(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	memory.published.length = 0;
	return { ...memory, foo: created.value };
};

describe("fooDelete", () => {
	it("lets the owner delete, publishes, sends a live update and clears the cache", async () => {
		const { ports, published, sent, state, foo } = await setup();
		const get = fooGet(ports);
		await get(owner, { fooId: foo.id });

		const result = await fooDelete(ports)(owner, { fooId: foo.id });

		expect(result).toEqual({ ok: true, value: undefined });
		expect(state.foos.has(foo.id)).toBe(false);
		expect(published).toEqual([
			{ data: { fooId: foo.id }, name: "foo.deleted" },
		]);
		expect(sent).toEqual([{ id: foo.id, type: "foo.deleted" }]);
		expect(await get(owner, { fooId: foo.id })).toEqual(
			err(expect.any(FooNotFoundError)),
		);
	});

	it("forbids a stranger and changes nothing", async () => {
		const { ports, published, sent, state, foo } = await setup();
		const result = await fooDelete(ports)(stranger, { fooId: foo.id });

		expect(result).toEqual(err(expect.any(FooForbiddenError)));
		expect(state.foos.get(foo.id)).toEqual(foo);
		expect(published).toEqual([]);
		expect(sent).toEqual([]);
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

	it("returns FooNotFoundError for an unknown id", async () => {
		const { ports, published, sent } = await setup();
		const result = await fooDelete(ports)(owner, { fooId: idCreate("foo") });

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
		expect(published).toEqual([]);
		expect(sent).toEqual([]);
	});
});
