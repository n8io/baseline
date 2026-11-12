import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { FooNotFoundError } from "../foo-errors.ts";
import { fooPortsMemoryCreate } from "../spi/foo-ports.memory.ts";
import { fooCreate } from "./foo-create.ts";
import { fooGet } from "./foo-get.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };

describe("fooGet", () => {
	it("returns FooNotFoundError for an unknown id", async () => {
		const { ports } = fooPortsMemoryCreate();
		const result = await fooGet(ports)(actor, { fooId: idCreate("foo") });

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});

	// piece-start: cache
	it("reads the foo, then serves the second get from the cache", async () => {
		const { ports, state } = fooPortsMemoryCreate();
		const created = await fooCreate(ports)(actor, { name: "alpha" });
		if (!created.ok) throw created.error;
		const get = fooGet(ports);

		const first = await get(actor, { fooId: created.value.id });
		state.foos.delete(created.value.id);
		const second = await get(actor, { fooId: created.value.id });

		expect(first).toEqual({ ok: true, value: created.value });
		expect(second).toEqual(first);
	});
	// piece-end: cache
});
