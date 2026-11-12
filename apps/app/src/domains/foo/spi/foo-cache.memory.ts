import { cacheMemoryCreate } from "@n8io/baseline-cache";
import type { FooPorts } from "../ports.ts";
import { fooCached } from "./foo-cached.ts";

export const fooCacheMemoryCreate = (): FooPorts["fooCache"] => {
	const cache = cacheMemoryCreate({ prefix: "foo", schema: fooCached });
	return {
		delete: cache.delete,
		get: cache.get,
		set: (foo) => cache.set(foo.id, foo),
	};
};
