import { describe, expect, test } from "vitest";
import { z } from "zod";
import type { Cache } from "../src/index.ts";

const Foo = z.object({ id: z.string(), name: z.string() });
type Foo = z.infer<typeof Foo>;

type CacheMake = <T>(options: {
	prefix: string;
	schema: z.ZodType<T>;
	ttlMs?: number;
}) => Cache<T>;

// The behaviour every Cache adapter must share. `wait` moves time forward:
// fake timers for memory, a real sleep for Redis.
export const cacheContract = (
	cacheMake: CacheMake,
	wait: (ms: number) => Promise<void>,
): void => {
	describe("cache contract", () => {
		const prefix = `test-${crypto.randomUUID()}`;
		const foo: Foo = { id: "foo_1", name: "First" };

		test("a missing id is a miss", async () => {
			const cache = cacheMake({ prefix, schema: Foo });
			expect(await cache.get("foo_missing")).toBeUndefined();
		});

		test("set then get returns the parsed value", async () => {
			const cache = cacheMake({ prefix, schema: Foo });
			await cache.set(foo.id, foo);
			expect(await cache.get(foo.id)).toEqual(foo);
		});

		test("set replaces an existing value", async () => {
			const cache = cacheMake({ prefix, schema: Foo });
			await cache.set(foo.id, foo);
			await cache.set(foo.id, { ...foo, name: "Second" });
			expect(await cache.get(foo.id)).toEqual({ ...foo, name: "Second" });
		});

		test("delete removes the value", async () => {
			const cache = cacheMake({ prefix, schema: Foo });
			await cache.set(foo.id, foo);
			await cache.delete(foo.id);
			expect(await cache.get(foo.id)).toBeUndefined();
		});

		test("prefixes keep caches apart", async () => {
			const fooCache = cacheMake({ prefix: `${prefix}-a`, schema: Foo });
			const barCache = cacheMake({ prefix: `${prefix}-b`, schema: Foo });
			await fooCache.set(foo.id, foo);
			expect(await barCache.get(foo.id)).toBeUndefined();
		});

		test("an entry that fails the schema is a miss", async () => {
			const oldCache = cacheMake({
				prefix: `${prefix}-old`,
				schema: z.object({ id: z.string() }),
			});
			const newCache = cacheMake({ prefix: `${prefix}-old`, schema: Foo });
			await oldCache.set(foo.id, { id: foo.id });
			expect(await newCache.get(foo.id)).toBeUndefined();
		});

		test("values round-trip through JSON, so a Date comes back a string", async () => {
			const cache = cacheMake({
				prefix: `${prefix}-date`,
				schema: z.object({ at: z.date() }),
			});
			await cache.set("at", { at: new Date() });
			expect(await cache.get("at")).toBeUndefined();
		});

		test("an entry expires after its TTL", async () => {
			const cache = cacheMake({ prefix, schema: Foo, ttlMs: 50 });
			await cache.set(foo.id, foo);
			await wait(20);
			expect(await cache.get(foo.id)).toEqual(foo);
			await wait(60);
			expect(await cache.get(foo.id)).toBeUndefined();
		});
	});
};
