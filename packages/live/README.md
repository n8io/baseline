# @n8io/baseline-live

Live updates: the server tells open pages that something changed, over Server-Sent Events, and each page reruns its loaders. Updates fan out across instances through Redis pub/sub.

```sh
pnpm add @n8io/baseline-live
```

## Exports

- `LiveHub`: `send(channel, { type, id })` and `close()`. An update says what changed, never the data. `send` is best effort and never rejects: see [When Redis is down](#when-redis-is-down). `await using` calls `close()` when its block ends.
- `liveHubRedisCreate({ redisClient })`: a hub on Redis pub/sub, for more than one instance.
- `liveHubMemoryCreate()`: a hub in one process, for unit tests and `memory://`.
- `liveStreamCreate({ liveHub, channel, id, expiresAt, signal })`: the SSE `Response` for one (channel, id), for any server that answers with a web `Response`. Pass the request's `signal`. It sends `ready` once subscribed, and again when the hub may have lost updates. It closes after 5 minutes, at `expiresAt` if sooner, or on `liveHub.close()`, and asks the page to reconnect within 1 to 5 s.
- `@n8io/baseline-live/testing`: `liveTestSseRead({ response })`, which reads a live stream in a test. See [Testing](#testing).
- `@n8io/baseline-live/client`: `useLiveUpdates({ channel, id, pathPrefix })`, a React hook that revalidates the page on each update, on every reconnect and on every `ready`. It opens `<pathPrefix>/<channel>/<id>`; `pathPrefix` defaults to `/live`, so pass it when the server mounts the streams elsewhere.

## Example

```ts
// Server: a route that streams one foo's updates.
import { liveStreamCreate } from "@n8io/baseline-live";

app.get("/live/foo/:fooId", (c) => {
	const live = liveStreamCreate({
		channel: "foo",
		expiresAt: c.var.authnExpiresAt ?? Number.POSITIVE_INFINITY,
		id: c.req.param("fooId"),
		liveHub,
		signal: c.req.raw.signal,
	});
	// Hono: answer through the context to keep headers that middleware set.
	return c.newResponse(live.body, live);
});

// After a change commits. No catch: a send never rejects.
await liveHub.send("foo", { id: foo.id, type: "foo.updated" });
```

```tsx
// Page: rerun this route's loaders when the foo changes.
import { useLiveUpdates } from "@n8io/baseline-live/client";

useLiveUpdates({ channel: "foo", id: foo.id });
```

## When Redis is down

A live update is a hint to reread, not data, so losing one never fails the change that caused it:

- `send` resolves when Redis fails or does not answer within 1 s. Each lost update is counted on `baseline.live.sends_failed` (by `baseline.live.channel`), and logged as one warning per 30 s per hub.
- Redis pub/sub does not replay what a subscriber missed. When a hub's subscriber connection comes back, every stream it holds sends `ready` again, spread over 1 to 5 s, and each page reruns its loaders. So a page is stale for the length of the outage and then catches up, without a reload.

## Testing

Test code that sends live updates with the memory hub, and read a stream with `liveTestSseRead` from `@n8io/baseline-live/testing`. Import it from test files only.

```ts
import { liveHubMemoryCreate, liveStreamCreate } from "@n8io/baseline-live";
import { liveTestSseRead } from "@n8io/baseline-live/testing";

const liveHub = liveHubMemoryCreate();
const response = liveStreamCreate({
	channel: "invoice",
	expiresAt: Number.POSITIVE_INFINITY,
	id: "invoice_1",
	liveHub,
});
const sse = liveTestSseRead({ response });
await sse.until("event: ready");

await liveHub.send("invoice", { id: "invoice_1", type: "invoice.updated" });

expect(await sse.until("invoice.updated")).toContain(
	'data: {"id":"invoice_1","type":"invoice.updated"}',
);
await liveHub.close();
```

- `until(text)` resolves with everything read once it holds `text`, and throws when the stream ends first.
- `end()` resolves with everything read once the server ends the stream.
- `cancel()` goes away like a page that closes.

`response` is any SSE `Response`: the one `liveStreamCreate` returns, your app's `app.request(...)`, or a `fetch` of a running server.

## Needs

- Peers: `@opentelemetry/api`, for the counter (it does nothing until your app registers a meter provider); `redis` only for its types, as this Package never imports it (`@n8io/baseline-redis` brings it); `react` and `react-router` only for `@n8io/baseline-live/client`. A service that only sends or streams updates installs neither.
- `liveHubRedisCreate` takes any connected node-redis client, such as one from `redisClientCreate` in `@n8io/baseline-redis`.

## Tests

`pnpm test` needs Docker: it starts a Redis container.
