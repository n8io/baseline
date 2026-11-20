import type { Actor } from "@n8io/baseline-authn";
import { idCreate } from "@n8io/baseline-id";
import { err } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../contexts.ts";
import { FooNotFoundError } from "../domain/errors.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

describe("fooGet", () => {
	it("returns the foo", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		const created = await useCases.fooCreate(actor, { name: "alpha" });
		if (!created.ok) throw created.error;

		const result = await useCases.fooGet(actor, { fooId: created.value.id });

		expect(result).toEqual({ ok: true, value: created.value });
	});

	it("returns FooNotFoundError for an unknown id", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		const result = await useCases.fooGet(actor, { fooId: idCreate("foo") });

		expect(result).toEqual(err(expect.any(FooNotFoundError)));
	});
});
