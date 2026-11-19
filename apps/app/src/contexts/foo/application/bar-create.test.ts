import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err, ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../adapters/outbound/foo-ports.memory.ts";
import { FooForbiddenError, FooNotFoundError } from "../domain/errors.ts";
import { barCreate } from "./bar-create.ts";
import { fooCreate } from "./foo-create.ts";

const owner: Actor = { id: "owner", kind: "user", scopes: [] };
const stranger: Actor = { id: "other", kind: "user", scopes: [] };

const setup = async () => {
	const memory = fooPortsMemoryCreate();
	const created = await fooCreate(memory.ports)(owner, { name: "alpha" });
	if (!created.ok) throw created.error;
	return { ...memory, foo: created.value };
};

describe("barCreate", () => {
	it("adds a bar to the owner's foo", async () => {
		const { clock, ports, state, foo } = await setup();

		const result = await barCreate(ports)(owner, {
			fooId: foo.id,
			text: "first",
		});

		const bar = {
			createdAt: clock.now(),
			createdBy: owner.id,
			fooId: foo.id,
			id: expect.any(String),
			text: "first",
		};
		expect(result).toEqual(ok(bar));
		expect([...state.bars.values()]).toEqual([bar]);
	});

	it("lets a holder of foo:update add one", async () => {
		const { ports, foo } = await setup();
		const result = await barCreate(ports)(
			{ ...stranger, scopes: ["foo:update"] },
			{ fooId: foo.id, text: "first" },
		);

		expect(result.ok).toBe(true);
	});

	it("forbids a stranger and adds nothing", async () => {
		const { ports, state, foo } = await setup();
		const result = await barCreate(ports)(stranger, {
			fooId: foo.id,
			text: "first",
		});

		expect(result).toEqual(err(expect.any(FooForbiddenError)));
		expect(state.bars.size).toBe(0);
	});

	it("returns FooNotFoundError for a foo that does not exist", async () => {
		const { ports, state } = await setup();
		const result = await barCreate(ports)(owner, {
			fooId: idCreate("foo"),
			text: "first",
		});

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
		expect(state.bars.size).toBe(0);
	});
});
