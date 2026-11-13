import type { StandardSchemaV1 } from "@standard-schema/spec";

// A typed cache for one kind of value, keyed by id.
export type Cache<T> = {
	delete(id: string): Promise<void>;
	get(id: string): Promise<T | undefined>;
	set(id: string, value: T): Promise<void>;
};

// Where entries live: raw JSON strings by key, each with a TTL. A composition root picks one
// (cacheStoreRedisCreate, cacheStoreMemoryCreate) and every cache is built on it.
export type CacheStore = {
	delete(key: string): Promise<void>;
	get(key: string): Promise<string | undefined>;
	set(key: string, json: string, ttlMs: number): Promise<void>;
};

export type CacheOptions<T> = {
	prefix: string;
	// Any Standard Schema (https://standardschema.dev): a Zod, Valibot or ArkType schema as it is.
	schema: StandardSchemaV1<unknown, T>;
	ttlMs?: number;
};

const cacheTtlMsDefault = 60_000;

const cacheJsonParse = (json: string): unknown => {
	try {
		return JSON.parse(json);
	} catch {
		return undefined;
	}
};

// A cache for one kind of value on any store: key `<prefix>:<id>`, JSON,
// validated by the schema on read. An entry that fails it (an older deploy may have
// written it) counts as a miss.
export const cacheCreate = <T>(
	store: CacheStore,
	{ prefix, schema, ttlMs = cacheTtlMsDefault }: CacheOptions<T>,
): Cache<T> => {
	const key = (id: string): string => `${prefix}:${id}`;

	return {
		delete: (id) => store.delete(key(id)),
		get: async (id) => {
			const json = await store.get(key(id));
			if (json === undefined) return undefined;
			const result = await schema["~standard"].validate(cacheJsonParse(json));
			return result.issues === undefined ? result.value : undefined;
		},
		set: (id, value) => store.set(key(id), JSON.stringify(value), ttlMs),
	};
};
