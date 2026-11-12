import { cacheMemoryCreate } from "@n8io/baseline-cache";
import type { FooCache } from "../ports.ts";
import { fooCached } from "./foo-cached.ts";

export const fooCacheMemoryCreate = (): FooCache => {
	const cache = cacheMemoryCreate({ prefix: "foo", schema: fooCached });
	return {
		delete: cache.delete,
		get: cache.get,
		set: (foo) => cache.set(foo.id, foo),
	};
};
