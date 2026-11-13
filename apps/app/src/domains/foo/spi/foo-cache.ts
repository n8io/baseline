import { type CacheStore, cacheCreate } from "@n8io/baseline-cache";
import type { FooPorts } from "../ports.ts";
import { fooCached } from "./foo-cached.ts";

// fooCached, not Foo: JSON turns dates into strings.
export const fooCacheCreate = (
	cacheStore: CacheStore,
): FooPorts["fooCache"] => {
	const cache = cacheCreate(cacheStore, { prefix: "foo", schema: fooCached });
	return {
		delete: cache.delete,
		get: cache.get,
		set: (foo) => cache.set(foo.id, foo),
	};
};
