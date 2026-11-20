# @n8io/baseline-redis

## 1.1.0

### Minor Changes

- e7bc75a: `redisClientCreate` refuses a bad `url` when called: `redisClientCreate: url is not a valid URL`, or `redisClientCreate: url must start with redis:// or rediss://, found "<scheme>"`.

### Patch Changes

- 84c85e1: README and doc comment wording: examples show their imports, Exports rows name each export, and glossary words read as the glossary writes them.
- 9a5b1a1: Package metadata in one voice: every Package commits its own copy of the MIT `LICENSE` (the tarball already carried the root one), and its npm description is rewritten from its README in the glossary's words. `@n8io/baseline-live` drops its unused optional `redis` peer and `@n8io/baseline-authn` its unused optional `react` peer; neither imports them. The `client` entries of authn and live build with `platform: "neutral"`, as they run in browsers (the output is unchanged).
- 3af66e4: A refused `vendor` key's `TypeError` message now starts with `redisClientCreate:`, and the README lists `url` among the refused keys in an Exports table.
- Updated dependencies [e7bc75a]
- Updated dependencies [bfb7735]
- Updated dependencies [9a5b1a1]
  - @n8io/baseline-logger@3.1.2

## 1.0.1

### Patch Changes

- e1fafaf: Rewrite the README: a promise, an animated diagram, a Guarantees table, a short example and the reference folded below.
- Updated dependencies [df8b85a]
  - @n8io/baseline-logger@3.1.1

## 1.0.0

### Major Changes

- 92e9814: Add `@n8io/baseline-redis`: `redisClientCreate({ url, vendor? })` opens the one Redis connection the cache and live updates share, with the startup and reconnect behaviour the Template used to hand-roll (fail at startup within 3 s, then reconnect for good; the `error` event always listened to). The Template's `src/redis.ts` becomes `src/redis-open.ts`, which only turns `CACHE_URL` into a client and its shutdown step, and the app no longer depends on `redis` directly.

  To upgrade: when `pnpm template-upgrade` conflicts on `src/redis.ts`, delete it and `src/redis.redis.test.ts`, and move any setting you changed there to `vendor` in `src/redis-open.ts`. Take `architecture-test-rules.ts` from the Template as it is.
