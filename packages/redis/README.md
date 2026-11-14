# @n8io/baseline-redis

The one Redis connection a process shares, for `@n8io/baseline-cache` and `@n8io/baseline-live`. It owns the parts every app gets wrong when it copies them: an unreachable Redis fails startup at once instead of retrying forever, a dropped connection reconnects for good after that, and the client's `error` event is always listened to, since node-redis exits the process on an unlistened one.

```sh
pnpm add @n8io/baseline-redis
```

## Exports

- `redisClientCreate({ url, vendor? })`: resolves with a connected node-redis client. The connect gives up after 3 s and never retries, so startup fails while Redis is unreachable. Once connected, a dropped connection reconnects every min(retries × 100 ms, 2 s), for as long as it takes. A command waits at most 1 s to be sent. Errors are logged at error, never with the URL, which may carry a password.
- `RedisClient`: what it resolves with, a node-redis client. Close it with `close()`; `await using` calls `close()` when its block ends.
- `RedisClientVendorOptions`: `vendor`, node-redis's own client settings (`socket.ca`, `name`, `keyPrefix`), outside the contract. A key the URL or this Package sets (`username`, `password`, `database`, `commandOptions`, `socket.connectTimeout`, `socket.reconnectStrategy`) throws.

`url` is `redis://` or `rediss://` (TLS), with any user, password and database in it. One URL fits a highly available Redis whose endpoint follows the primary: a managed one, or a proxy in front of Sentinel. For Sentinel or Cluster addressed directly, build the client with node-redis's `createSentinel` or `createCluster` yourself and pass it to the cache and live adapters, which take any connected node-redis client.

## Example

Open one connection per process and build the cache store and live hub on it:

```ts
import { cacheStoreRedisCreate } from "@n8io/baseline-cache";
import { liveHubRedisCreate } from "@n8io/baseline-live";
import { redisClientCreate } from "@n8io/baseline-redis";

const redisClient = await redisClientCreate({ url: ENV.CACHE_URL });
const cacheStore = cacheStoreRedisCreate({ redisClient });
const liveHub = liveHubRedisCreate({ redisClient });

// At shutdown, after the live hub:
await liveHub.close();
await redisClient.close();
```

## Tests

`pnpm test` runs every test; the `*.redis.test.ts` files start a Redis container, so they need Docker.
