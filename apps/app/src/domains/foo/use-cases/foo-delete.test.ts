import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { FooForbiddenError, FooNotFoundError } from "../foo-errors.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
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

	it("returns FooNotFoundError for an unknown id", async () => {
		const { ports } = await setup();
		const result = await fooDelete(ports)(owner, { fooId: idCreate("foo") });

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});
});
