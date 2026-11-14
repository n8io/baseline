import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import {
	FooForbiddenError,
	FooNameTakenError,
	FooNotFoundError,
} from "../foo-errors.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooCreate } from "./foo-create.ts";
import { fooDelete } from "./foo-delete.ts";
import { fooGet } from "./foo-get.ts";
import { fooUpdate } from "./foo-update.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

const setup = async () => {
	const memory = fooPortsMemoryCreate();
	const created = await fooCreate(memory.ports)(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { ...memory, foo: created.value };
};

describe("fooUpdate", () => {
	it("lets the owner rename, and the next get reads the new name", async () => {
		const { ports, foo } = await setup();
		const get = fooGet(ports);
		await get(owner, { fooId: foo.id });

		const result = await fooUpdate(ports)(owner, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual({
			ok: true,
			value: expect.objectContaining({ id: foo.id, name: "beta" }),
		});
		expect(await get(owner, { fooId: foo.id })).toEqual({
			ok: true,
			value: expect.objectContaining({ name: "beta" }),
		});
	});

	it("stamps updatedAt from the clock", async () => {
		const { clock, ports, foo } = await setup();
		clock.advance(60_000);

		const result = await fooUpdate(ports)(owner, {
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
		const { ports, foo } = await setup();

		const [deleted, updated] = await Promise.all([
			fooDelete(ports)(owner, { fooId: foo.id }),
			fooUpdate(ports)(owner, { fooId: foo.id, name: "beta" }),
		]);

		expect(deleted.ok).toBe(true);
		expect(updated).toEqual(err(new FooNotFoundError(foo.id)));
	});

	it("forbids a stranger and changes nothing", async () => {
		const { ports, state, foo } = await setup();
		const result = await fooUpdate(ports)(stranger, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooForbiddenError)));
		expect(state.foos.get(foo.id)).toEqual(foo);
	});

	it("lets a holder of foo:update rename", async () => {
		const { ports, foo } = await setup();
		const result = await fooUpdate(ports)(
			{ ...stranger, scopes: ["foo:update"] },
			{ fooId: foo.id, name: "beta" },
		);

		expect(result.ok).toBe(true);
	});

	it("returns FooNotFoundError for an unknown id", async () => {
		const { ports } = await setup();
		const result = await fooUpdate(ports)(owner, {
			fooId: idCreate("foo"),
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});

	it("returns FooNameTakenError when another foo has the name", async () => {
		const { ports, state, foo } = await setup();
		await fooCreate(ports)(owner, { name: "beta" });

		const result = await fooUpdate(ports)(owner, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooNameTakenError)));
		expect(state.foos.get(foo.id)?.name).toBe("alpha");
	});
});
