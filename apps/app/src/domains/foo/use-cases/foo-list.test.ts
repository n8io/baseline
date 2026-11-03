import type { Actor } from "@n8io/baseline-authn";
import { describe, expect, it } from "vitest";
import { FooListInput } from "../models/foo.ts";
import { fooPortsMemory } from "../spi/foo-ports.memory.ts";
import { fooCreate } from "./foo-create.ts";
import { fooList } from "./foo-list.ts";

const actor: Actor = { id: "u1", kind: "user", scopes: [] };

describe("fooList", () => {
	it("returns an empty page when there are no foos", async () => {
		const { ports } = fooPortsMemory();
		const result = await fooList(ports)(actor, FooListInput.parse({}));

		expect(result).toEqual({
			ok: true,
			value: { items: [], nextCursor: null },
		});
	});

	it("passes the input through to the repository", async () => {
		const { ports } = fooPortsMemory();
		const create = fooCreate(ports);
		await create(actor, { name: "b" });
		await create(actor, { name: "a" });
		await create(actor, { name: "c" });

		const result = await fooList(ports)(
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
