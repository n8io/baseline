import { expect, it } from "vitest";
import { z } from "zod";
import { cacheStoreContract } from "./cache-store.contract.ts";
import { cacheCreate, cacheStoreMemoryCreate } from "./index.ts";

// A clock the tests move by hand, read by the store and by the cache.
const clock = { at: 0 };
const now = () => clock.at;
const advance = (ms: number) => {
	clock.at += ms;
};

const store = cacheStoreMemoryCreate({ now });

cacheStoreContract(
	() => store,
	async (ms) => {
		advance(ms);
	},
);

it("a null ttlMs and onStoreError take the defaults", async () => {
	const cache = cacheCreate(cacheStoreMemoryCreate({ now }), {
		now,
		onStoreError: null,
		prefix: "foo",
		schema: z.string(),
		ttlMs: null,
	});
	await cache.set("foo_1", "First");
	advance(59_999);
	expect(await cache.get("foo_1")).toBe("First");
	advance(1);
	expect(await cache.get("foo_1")).toBeUndefined();
});

it("entries expire after 60 s by default", async () => {
	const cache = cacheCreate(cacheStoreMemoryCreate({ now }), {
		now,
		prefix: "foo",
		schema: z.string(),
	});
	await cache.set("foo_1", "First");
	advance(59_999);
	expect(await cache.get("foo_1")).toBe("First");
	advance(1);
	expect(await cache.get("foo_1")).toBeUndefined();
});
