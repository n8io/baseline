import { idCreate } from "@n8io/baseline-id";
import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { connectionsOpen } from "../../../connections.ts";
import type { Foo } from "../models/foo.ts";
import { fooPortsCreate } from "./index.ts";

const fooBuild = (): Foo => ({
	archivedAt: null,
	createdAt: new Date("2026-01-01T00:00:00.000Z"),
	createdBy: "u1",
	id: idCreate("foo"),
	name: "alpha",
	updatedAt: new Date("2026-01-02T00:00:00.000Z"),
});

describe("fooPortsCreate", () => {
	it("builds memory ports for a memory database", async () => {
		const ports = fooPortsCreate(await connectionsOpen({ role: "publisher" }));
		const foo = fooBuild();
		await ports.fooTransaction(async ({ fooRepository }) => {
			await fooRepository.insert(foo);
			return ok(undefined);
		});
		expect(await ports.fooReadRepository.findById(foo.id)).toEqual(foo);
	});

	// piece-start: cache
	// The memory store keeps JSON like every other store, so this covers the round trip on all of them.
	it("caches a foo under its id with its dates intact", async () => {
		const { fooCache } = fooPortsCreate(
			await connectionsOpen({ role: "publisher" }),
		);
		const foo = { ...fooBuild(), archivedAt: new Date("2026-02-01") };

		expect(await fooCache.get(foo.id)).toBeUndefined();
		await fooCache.set(foo);
		expect(await fooCache.get(foo.id)).toEqual(foo);
		await fooCache.set({ ...foo, archivedAt: null });
		expect(await fooCache.get(foo.id)).toEqual({ ...foo, archivedAt: null });
		await fooCache.delete(foo.id);
		expect(await fooCache.get(foo.id)).toBeUndefined();
	});
	// piece-end: cache
});
