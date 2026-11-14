# Closing with `using`

Read when you open something that must be closed: a hub, a pool, a queue, a server, a temp folder.

Use `using` for a resource that lives for one block (a test, a script step, a short helper); the shutdown package owns everything that lives as long as the process. So `src/connections.ts`, the `src/*-open.ts` files, `src/server.ts` and `src/worker.ts` keep handing named closes to the shutdown steps.

Every Baseline handle that must be closed has `[Symbol.asyncDispose]`, which calls its named close: `LiveHub`, `Queue`, `HealthServer`, `Analytics`, `ErrorTracking`, `PostgresPool` and `RedisClient` (from `redisClientCreate`; a `duplicate()` of it has none). Declare it with `await using` and it closes however the block ends, even when an `expect` throws first:

```ts
test("sends the update", async () => {
	await using liveHub = liveHubMemoryCreate();
	// ...
});
```

Where closing is what the test checks, keep the explicit call and declare the handle with `const`, not `await using`: a pool or a server throws when it is closed twice. A fixture opened in `beforeAll` and closed in `afterAll` stays as it is: a `using` variable cannot span hooks. A vendor's own client (other than `redisClientCreate`'s) has no dispose method: close it in Vitest's `onTestFinished`, never in a wrapper.

## Traps

- Inside a `using` scope, write `return await work()`. A bare `return work()` closes the resource before the promise settles.
- A top-level `await using` in a module closes when the file finishes loading. Use it only inside a block or function.
- When the block throws and the close throws too, the result is a `SuppressedError`: `.error` is the failed close and `.suppressed` the first error. The logger follows `cause` only, so it shows neither; log both yourself where that matters.
