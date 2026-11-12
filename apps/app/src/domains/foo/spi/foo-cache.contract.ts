import { idCreate } from "@n8io/baseline-id";
import { describe, expect, it } from "vitest";
import type { Foo } from "../models/foo.ts";
import type { FooPorts } from "../ports.ts";

// Runs against every fooCache adapter: in memory and on Redis.
export const fooCacheContract = (
	create: () => Promise<FooPorts["fooCache"]>,
): void => {
	describe("fooCache", () => {
		it("misses, then returns the foo it stored with its dates intact", async () => {
			const fooCache = await create();
			const foo: Foo = {
				archivedAt: new Date("2026-02-01T00:00:00.000Z"),
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				createdBy: "user-1",
				id: idCreate("foo"),
				name: "Alpha",
				updatedAt: new Date("2026-01-02T00:00:00.000Z"),
			};
			expect(await fooCache.get(foo.id)).toBeUndefined();
			await fooCache.set(foo);
			expect(await fooCache.get(foo.id)).toEqual(foo);
			await fooCache.set({ ...foo, archivedAt: null });
			expect(await fooCache.get(foo.id)).toEqual({ ...foo, archivedAt: null });
			await fooCache.delete(foo.id);
			expect(await fooCache.get(foo.id)).toBeUndefined();
		});
	});
};
