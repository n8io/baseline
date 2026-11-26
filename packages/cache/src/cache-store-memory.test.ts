import { describe, expect, it } from "vitest";
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

// A store of its own: it answers for a key it never held, and drops an entry once it has expired.
describe("cacheStoreMemoryCreate", () => {
	it("answers undefined for a key it never held", async () => {
		const own = cacheStoreMemoryCreate({ now });

		expect(await own.get("missing")).toBeUndefined();
	});

	it("drops an expired entry for good, even if the clock goes back", async () => {
		const own = cacheStoreMemoryCreate({ now });
		const start = clock.at;
		await own.set({ json: '"First"', key: "foo:1", ttlMs: 10 });
		expect(await own.get("foo:1")).toBe('"First"');

		advance(10);
		expect(await own.get("foo:1")).toBeUndefined();
		advance(-10);

		expect(clock.at).toBe(start);
		expect(await own.get("foo:1")).toBeUndefined();
	});

	it("keeps an entry until its ttl is reached, and expires it at that moment", async () => {
		const own = cacheStoreMemoryCreate({ now });
		await own.set({ json: '"First"', key: "foo:1", ttlMs: 10 });

		advance(9);
		expect(await own.get("foo:1")).toBe('"First"');
		advance(1);
		expect(await own.get("foo:1")).toBeUndefined();
	});

	it("deletes one key and leaves the others", async () => {
		const own = cacheStoreMemoryCreate({ now });
		await own.set({ json: "1", key: "foo:1", ttlMs: 10 });
		await own.set({ json: "2", key: "foo:2", ttlMs: 10 });

		await own.delete("foo:1");

		expect(await own.get("foo:1")).toBeUndefined();
		expect(await own.get("foo:2")).toBe("2");
	});
});
