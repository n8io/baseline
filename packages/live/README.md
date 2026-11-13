# @n8io/baseline-live

Live updates: the server tells open pages that something changed, over Server-Sent Events, and each page reruns its loaders. Updates fan out across instances through Redis pub/sub.

```sh
pnpm add @n8io/baseline-live
```

## Exports

- `LiveHub`: `send(channel, { type, id })` and `close()`. An update says what changed, never the data.
- `liveHubRedisCreate(redisClient)`: a hub on Redis pub/sub, for more than one instance.
- `liveHubMemoryCreate()`: a hub in one process, for unit tests and `memory://`.
- `liveStreamCreate(c, { liveHub, channel, id, expiresAt })`: the SSE response for one (channel, id). It closes after 5 minutes, at `expiresAt` if sooner, or on `liveHub.close()`, and asks the page to reconnect within 1 to 5 s.
- `@n8io/baseline-live/client`: `useLiveUpdates(channel, id, { pathPrefix })`, a React hook that revalidates the page on each update and on every reconnect. It opens `<pathPrefix>/<channel>/<id>`; `pathPrefix` defaults to `/live`, so pass it when the server mounts the streams elsewhere.

## Example

```ts
// Server: a route that streams one foo's updates.
import { liveStreamCreate } from "@n8io/baseline-live";

app.get("/live/foo/:fooId", (c) =>
	liveStreamCreate(c, {
		channel: "foo",
		expiresAt: c.var.authnExpiresAt ?? Number.POSITIVE_INFINITY,
		id: c.req.param("fooId"),
		liveHub,
	}),
);

// After a change commits:
await liveHub.send("foo", { id: foo.id, type: "foo.updated" });
```

```tsx
// Page: rerun this route's loaders when the foo changes.
import { useLiveUpdates } from "@n8io/baseline-live/client";

useLiveUpdates("foo", foo.id);
```

## Needs

- Peers: `hono`; `redis` unless you only use `liveHubMemoryCreate`; `react` and `react-router` only for `@n8io/baseline-live/client`. A service that only sends or streams updates installs neither.
- `liveHubRedisCreate` takes any connected node-redis client, such as the one the Template's `src/redis.ts` opens.

## Tests

`pnpm test` needs Docker: it starts a Redis container.
