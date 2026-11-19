import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import { contextsCreate } from "../../../use-cases.ts";
import { FooListInput } from "../domain/foo.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };
const connections = await connectionsOpen({ role: "publisher" });

describe("fooList", () => {
	it("returns an empty page when there are no foos", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		const result = await useCases.fooList(actor, FooListInput.parse({}));

		expect(result).toEqual({
			ok: true,
			value: { items: [], nextCursor: null },
		});
	});

	it("sorts, pages and counts as the input asks", async () => {
		const { useCases } = contextsCreate(connections).fooContext;
		for (const name of ["b", "a", "c"]) {
			await useCases.fooCreate(actor, { name });
		}

		const result = await useCases.fooList(
			actor,
			FooListInput.parse({ count: true, limit: 2, sort: "name" }),
		);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.items.map((foo) => foo.name)).toEqual(["a", "b"]);
		expect(result.value.total).toBe(3);
		expect(result.value.nextCursor).toEqual(expect.any(String));
	});
});
