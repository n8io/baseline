# @n8io/baseline-redis

**The one Redis connection a process shares, with the parts every app gets wrong already right.** An unreachable Redis fails startup at once instead of retrying forever, a connection dropped later reconnects for good, and the client's `error` event is always listened to, so an error never exits the process.

```sh
pnpm add @n8io/baseline-redis
```

<p align="center"><img src="https://raw.githubusercontent.com/n8io/baseline/main/docs/readme/redis-lifecycle.svg" width="880" alt="redisClientCreate: at startup the connect succeeds within 3 s or throws without retrying; once connected, a dropped connection retries forever, waiting 100 ms more each time up to 2 s."></p>

## Guarantees

| You get                                 | How                                                                                                                                       |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Startup fails fast**                  | The connect, handshake included, gives up after 3 s and never retries.                                                                    |
| **Reconnects for good once up**         | A dropped connection retries every min(retries × 100 ms, 2 s), for as long as it takes.                                                   |
| **The process survives an error event** | The client's `error` event is always listened to and logged at error.                                                                     |
| **Its logs never carry the password**   | Errors are logged without the URL, which may carry one.                                                                                   |
| **No command stuck waiting to be sent** | A command waits at most 1 s to be sent.                                                                                                   |
| **One client for cache and live**       | `cacheStoreRedisCreate` and `liveHubRedisCreate` both take the client it resolves with; the live hub duplicates it for its subscriptions. |
| **Closed with its block**               | `await using` calls `close()` when the block ends.                                                                                        |

## Example

Open one connection per process and build the cache store and live hub on it:

```ts
import { cacheStoreRedisCreate } from "@n8io/baseline-cache";
import { liveHubRedisCreate } from "@n8io/baseline-live";
import { redisClientCreate } from "@n8io/baseline-redis";

// redis:// or rediss://; the Template opens no client for memory://
const redisClient = await redisClientCreate({ url: ENV.CACHE_URL });
const cacheStore = cacheStoreRedisCreate({ redisClient });
const liveHub = liveHubRedisCreate({ redisClient });

// At shutdown, after the live hub:
await liveHub.close();
await redisClient.close();
```

Unit tests need no Redis: build them on `cacheStoreMemoryCreate()` and `liveHubMemoryCreate()` instead. The Package's own `pnpm test` runs every test; the `*.redis.test.ts` files start a Redis container, so they need Docker; `pnpm test:unit` runs the tests that need no Redis.

## Reference

<details><summary><b>Exports</b></summary>

| Export                                | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redisClientCreate({ url, vendor? })` | Resolves with a connected node-redis client, or rejects with `TypeError` on a `url` that is not valid or not `redis://` or `rediss://`. The connect, handshake included, gives up after 3 s and never retries, so startup fails while Redis is unreachable or not answering. Once connected, a dropped connection reconnects every min(retries × 100 ms, 2 s), for as long as it takes. A command waits at most 1 s to be sent. Errors are logged at error, never with the URL, which may carry a password. |
| `RedisClient`                         | What it resolves with, a node-redis client. Close it with `close()`; `await using` calls `close()` when its block ends.                                                                                                                                                                                                                                                                                                                                                                                     |
| `RedisClientOptions`                  | What `redisClientCreate` takes, `{ url, vendor? }`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `RedisConnection`                     | The commands and lifecycle calls the cache store, the live hub and shutdown use; not node-redis's own type. Reach any other command through an adapter of your own.                                                                                                                                                                                                                                                                                                                                         |

</details>

<details><summary><b>URLs, Sentinel and Cluster</b></summary>

`url` is `redis://` or `rediss://` (TLS), with any user, password and database in it. One URL fits a highly available Redis whose endpoint follows the primary: a managed one, or a proxy in front of Sentinel. For Sentinel or Cluster addressed directly, `pnpm add redis` and build the client with node-redis's `createSentinel` or `createCluster` yourself, with your own `error` listener, and pass it to the cache and live adapters, which take any connected node-redis client. Nothing tests that path.

</details>

**Needs** a Redis URL (`redis://` or `rediss://`; the Template reads it from `CACHE_URL`). Runs on node-redis.
