import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import {
	FooForbiddenError,
	FooNameTakenError,
	FooNotFoundError,
} from "../foo-errors.ts";
import { fooPortsMemory } from "../spi/foo-ports.memory.ts";
import { fooCreate } from "./foo-create.ts";
import { fooGet } from "./foo-get.ts";
import { fooUpdate } from "./foo-update.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

const setup = async () => {
	const memory = fooPortsMemory();
	const created = await fooCreate(memory.ports)(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { ...memory, foo: created.value };
};

describe("fooUpdate", () => {
	it("lets the owner rename, sends a live update and clears the cache", async () => {
		const { ports, sent, foo } = await setup();
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
		expect(sent).toEqual([{ id: foo.id, type: "foo.updated" }]);
		expect(await get(owner, { fooId: foo.id })).toEqual({
			ok: true,
			value: expect.objectContaining({ name: "beta" }),
		});
	});

	it("forbids a stranger and changes nothing", async () => {
		const { ports, sent, state, foo } = await setup();
		const result = await fooUpdate(ports)(stranger, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooForbiddenError)));
		expect(state.foos.get(foo.id)).toEqual(foo);
		expect(sent).toEqual([]);
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
		const { ports, sent } = await setup();
		const result = await fooUpdate(ports)(owner, {
			fooId: idCreate("foo"),
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
		expect(sent).toEqual([]);
	});

	it("returns FooNameTakenError when another foo has the name", async () => {
		const { ports, sent, state, foo } = await setup();
		await fooCreate(ports)(owner, { name: "beta" });

		const result = await fooUpdate(ports)(owner, {
			fooId: foo.id,
			name: "beta",
		});

		expect(result).toEqual(err(expect.any(FooNameTakenError)));
		expect(state.foos.get(foo.id)?.name).toBe("alpha");
		expect(sent).toEqual([]);
	});
});
