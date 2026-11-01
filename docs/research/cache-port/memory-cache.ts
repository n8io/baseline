// In-memory cache with lazy, Date.now-based expiry and a size limit (oldest-first eviction).
type Entry = { value: string; expiresAt: number | null };

export const fooCacheMemory = (options: { maxEntries?: number; now?: () => number } = {}) => {
  const { maxEntries = 1000, now = Date.now } = options;
  const entries = new Map<string, Entry>(); // Map keeps insertion order

  return {
    async get(key: string) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (entry.expiresAt !== null && entry.expiresAt <= now()) {
        entries.delete(key);
        return null;
      }
      // refresh recency (LRU-style)
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    async set(key: string, value: string, ttlMs?: number) {
      entries.delete(key);
      entries.set(key, { value, expiresAt: ttlMs === undefined ? null : now() + ttlMs });
      if (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
    },
    async delete(key: string) {
      entries.delete(key);
    },
    get size() {
      return entries.size;
    },
  };
};
