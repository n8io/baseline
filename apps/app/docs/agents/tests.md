# A context's tests

Read when writing or deleting a context's tests. A context has one interface, its `index.ts`, and its tests go through the same entry its callers do.

## Through the interface

Build the context the way the entry points do, on memory connections, and drive what it hands back:

```ts
const connections = await connectionsOpen({ role: "publisher" });
const { useCases } = contextsCreate(connections).invoiceContext;
```

- Call `useCases`, or mount `routes` on a Hono app, or run a `schedules` entry or a `seeds` entry. Run an Event handler from `handlers` with `queueTestConsumerRun`.
- Assert on what the call returns and on what a later read returns (`invoiceGet` after `invoiceUpdate`), never on a memory adapter's state.
- A context that reads another gets it from `contextsCreate`, so its test needs no fake of the upstream.
- To set the time, spread a memory clock into the connections: `{ ...connections, clock: clockMemoryCreate(now) }`, then `clock.set` or `clock.advance`.
- Write cases with `it`, not `test`.
- No `vi.mock`, `vi.fn`, `vi.spyOn` or fake timers: a hand-written double on a connection is the one way to see what leaves a context, and the memory clock the one way to move time.
- To see what leaves the context, spread a recording double into the connection it leaves through: an `analytics` that keeps what `track` gets, a `liveHub` that keeps what `send` gets, a `cacheStore` that counts hits. A failing double (a `cacheStore` that throws) tests that the change still goes through.
- Domain events need a real queue: test them in `*-transaction.postgres.test.ts` through `contextsCreate` on `connectionsOpen({ role: "publisher", urls: { cache: "memory://", database } })`, after subscribing stand-in Event handlers.
- A test that reads an app file declares it (`import.meta.glob([...], { query: "?raw" })`) or says `// Reads and runs no file of the app`; `structure.test.ts` fails one that does neither, and any test outside `src/`, `scripts/`, `test/` or the app root.
- Context test files share one import graph (`isolate: false`): keep the modules they share free of state a test changes.

## Past the interface

Only three kinds of test reach behind `index.ts`:

- A port with two adapters: the repository suite in `<model>-repository.contract.ts`, run on memory and on Postgres, and the transaction's commit and rollback.
- A race: two transactions interleaved on Postgres (`postgresTestInterleave`), which memory cannot show.
- An invariant no read can show, such as a Model's rows deleted with another's: drive it through the interface on Postgres, then look in the table.

Delete a test that only repeats an interface test, such as a test of one model function or predicate whose cases a Use case test covers, or a unit test of a thin adapter. Move a case it has that no interface test covers into the Use case test first.

## Rules Biome checks

Biome GritQL plugins in `lint-plugins/`, attached by `overrides` in `biome.json`, check A15 (`sql.raw`), A26 (system time in a Use case), `process.env` (A22) and the mock, spy and fake-timer ban, so `pnpm check` shows them. Each plugin has a sample in `lint-plugin-samples/` (same layout as `architecture-test-samples/`, run by `lint-plugins.test.ts`). A new plugin gets its sample and an `overrides` entry that scopes it by path.
