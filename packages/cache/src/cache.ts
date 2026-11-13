import { logger } from "@n8io/baseline-logger";
import { type Counter, metrics } from "@opentelemetry/api";
import type { StandardSchemaV1 } from "@standard-schema/spec";

// A typed cache for one kind of value, keyed by id. Unless it was made with
// `onStoreError: "throw"`, no call rejects because the store failed.
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
	set(entry: { json: string; key: string; ttlMs: number }): Promise<void>;
};

export type CacheOptions<T> = {
	// What a store error or timeout does. "miss" (the default) keeps the caller serving: a failed
	// get is a miss, and a failed set or delete is logged and counted. "throw" rejects the call.
	onStoreError?: "miss" | "throw";
	prefix: string;
	// Any Standard Schema (https://standardschema.dev): a Zod, Valibot or ArkType schema as it is.
	schema: StandardSchemaV1<unknown, T>;
	ttlMs?: number;
};

const cacheTtlMsDefault = 60_000;

const cacheWarnIntervalMs = 30_000;

let storeErrors: Counter | undefined;

// Taken on first use, after the telemetry preload has registered the meter provider.
const cacheStoreErrorsCounter = (): Counter => {
	storeErrors ??= metrics
		.getMeter("@n8io/baseline-cache")
		.createCounter("baseline.cache.store_errors", {
			description: "Cache store calls that failed and were not rethrown",
			unit: "{call}",
		});
	return storeErrors;
};

const cacheJsonParse = (json: string): unknown => {
	try {
		return JSON.parse(json);
	} catch {
		return undefined;
	}
};

// A cache for one kind of value on any store: key `<prefix>:<id>`, JSON,
// validated by the schema on read. An entry that fails it (an older deploy may have
// written it) counts as a miss. So does a store that fails, unless `onStoreError` is "throw".
export const cacheCreate = <T>(
	store: CacheStore,
	{
		onStoreError = "miss",
		prefix,
		schema,
		ttlMs = cacheTtlMsDefault,
	}: CacheOptions<T>,
): Cache<T> => {
	const key = (id: string): string => `${prefix}:${id}`;
	// Ids whose set or delete failed, with when the entry the store may still hold has expired.
	// Until then this process reads them as misses, so it never serves a value it tried to replace.
	const staleUntil = new Map<string, number>();
	let warnedAt = Number.NEGATIVE_INFINITY;
	let unlogged = 0;

	// Counts every failure and warns once per 30 s, so an outage is not one line per call.
	const storeFailed = (operation: string, err: unknown): void => {
		if (onStoreError === "throw") throw err;
		cacheStoreErrorsCounter().add(1, {
			"baseline.cache.operation": operation,
			"baseline.cache.prefix": prefix,
		});
		if (Date.now() - warnedAt < cacheWarnIntervalMs) {
			unlogged += 1;
			return;
		}
		logger.warn(
			{ err, operation, prefix, unlogged },
			"Cache store failed; serving without the cache",
		);
		warnedAt = Date.now();
		unlogged = 0;
	};

	const staleMark = (id: string): void => {
		const now = Date.now();
		// Oldest first: every mark lasts ttlMs, so the first live one ends the sweep.
		for (const [staleId, until] of staleUntil) {
			if (until > now) break;
			staleUntil.delete(staleId);
		}
		staleUntil.delete(id);
		staleUntil.set(id, now + ttlMs);
	};

	return {
		delete: async (id) => {
			try {
				await store.delete(key(id));
			} catch (err) {
				storeFailed("delete", err);
				staleMark(id);
			}
		},
		get: async (id) => {
			if ((staleUntil.get(id) ?? 0) > Date.now()) return undefined;
			let json: string | undefined;
			try {
				json = await store.get(key(id));
			} catch (err) {
				storeFailed("get", err);
			}
			if (json === undefined) return undefined;
			const result = await schema["~standard"].validate(cacheJsonParse(json));
			return result.issues === undefined ? result.value : undefined;
		},
		set: async (id, value) => {
			const json = JSON.stringify(value);
			try {
				await store.set({ json, key: key(id), ttlMs });
			} catch (err) {
				storeFailed("set", err);
				staleMark(id);
			}
		},
	};
};
