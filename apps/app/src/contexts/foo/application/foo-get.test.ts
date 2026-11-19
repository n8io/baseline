import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { fooPortsMemoryCreate } from "../adapters/outbound/foo-ports.memory.ts";
import { FooNotFoundError } from "../domain/errors.ts";
import { fooCreate } from "./foo-create.ts";
import { fooGet } from "./foo-get.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };

describe("fooGet", () => {
	it("returns the foo", async () => {
		const { ports } = fooPortsMemoryCreate();
		const created = await fooCreate(ports)(actor, { name: "alpha" });
		if (!created.ok) throw created.error;

		const result = await fooGet(ports)(actor, { fooId: created.value.id });

		expect(result).toEqual({ ok: true, value: created.value });
	});

	it("returns FooNotFoundError for an unknown id", async () => {
		const { ports } = fooPortsMemoryCreate();
		const result = await fooGet(ports)(actor, { fooId: idCreate("foo") });

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});
});
