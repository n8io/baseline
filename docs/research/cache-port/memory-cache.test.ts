import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fooCacheMemory } from './memory-cache.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it('expires after the ttl, with no real waiting', async () => {
  const cache = fooCacheMemory();
  await cache.set('foo:1', 'a', 1000);
  vi.advanceTimersByTime(999);
  expect(await cache.get('foo:1')).toBe('a');
  vi.advanceTimersByTime(1);
  expect(await cache.get('foo:1')).toBeNull();
});

it('works with setSystemTime too (Date.now is faked by default)', async () => {
  const cache = fooCacheMemory();
  await cache.set('foo:1', 'a', 1000);
  vi.setSystemTime(Date.now() + 5000);
  expect(await cache.get('foo:1')).toBeNull();
});

it('evicts the least recently used entry past the size limit', async () => {
  const cache = fooCacheMemory({ maxEntries: 2 });
  await cache.set('a', '1');
  await cache.set('b', '2');
  await cache.get('a');
  await cache.set('c', '3');
  expect(await cache.get('b')).toBeNull();
  expect(await cache.get('a')).toBe('1');
});

it('a setTimeout-based sweeper also works under fake timers but leaves entries until it runs', async () => {
  const entries = new Map<string, string>();
  const set = (k: string, v: string, ttl: number) => {
    entries.set(k, v);
    setTimeout(() => entries.delete(k), ttl).unref();
  };
  set('x', 'y', 1000);
  vi.advanceTimersByTime(1000);
  expect(entries.has('x')).toBe(false);
});
