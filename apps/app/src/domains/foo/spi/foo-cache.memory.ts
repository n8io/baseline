import { cacheMemory } from "@n8io/baseline-cache";
import type { FooCache } from "../ports.ts";
import { fooCached } from "./foo-cached.ts";

export const fooCacheMemory = (): FooCache => {
	const cache = cacheMemory({ prefix: "foo", schema: fooCached });
	return {
		delete: cache.delete,
		get: cache.get,
		set: (foo) => cache.set(foo.id, foo),
	};
};
