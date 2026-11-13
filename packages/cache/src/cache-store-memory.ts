import type { CacheStore } from "./cache.ts";

// A store held in this process, for development and unit tests. It keeps
// JSON like Redis does, so a value that does not survive the round trip
// (a Date comes back as a string) fails the same way. Expiry reads Date.now,
// so fake timers move it.
export const cacheStoreMemoryCreate = (): CacheStore => {
	const entries = new Map<string, { expiresAt: number; json: string }>();

	return {
		delete: async (key) => {
			entries.delete(key);
		},
		get: async (key) => {
			const entry = entries.get(key);
			if (entry === undefined) return undefined;
			if (entry.expiresAt <= Date.now()) {
				entries.delete(key);
				return undefined;
			}
			return entry.json;
		},
		set: async ({ json, key, ttlMs }) => {
			entries.set(key, { expiresAt: Date.now() + ttlMs, json });
		},
	};
};
