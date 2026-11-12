---
"app": major
---

The Template carries half as many piece blocks (87 pairs, down from 193, and none above 5 in a file). The composition roots open every connection through `connectionsOpen(ENV, role)` in the new `src/connections.ts`, which calls one file per piece (`src/redis.ts`, `src/live-hub-open.ts`, `src/queue-open.ts`) and returns the shutdown steps too. Each Domain tests its cache, live updates and Events in files of their own (`use-cases/<domain>-use-cases-<piece>.test.ts`, `spi/index-queue.test.ts`), so the shared tests carry no blocks. Behaviour is unchanged.

Upgrading changes every Domain. In each one:

- `spi/index.ts`: `<domain>PortsCreate(connections: Connections)` takes the object `connectionsOpen` returns. The cache reads `connections.redis` instead of an option named `cache`; `database`, `queue` and `liveHub` keep their names.
- `ports.ts`: the cache, live updates and Events port types sit inline in `<Domain>Ports` and `<Domain>TransactionPorts`; the separate `<Domain>Cache`, `<Domain>LiveUpdates` and `<Domain>Events` types are gone. Name them as `<Domain>Ports["<domain>Cache"]` where you need them.
- `index.ts` re-exports its errors, models and port types with `export *`.
- `spi/<domain>-ports.memory.ts` returns `{ ports, state }`; committed Events are in `state.published`, and the memory live updates port sends nothing.
- The get, update and delete Use cases take the whole `<Domain>Ports`.

In `src/server.ts`, `src/worker.ts` and `src/seed.ts`, replace the Redis, queue and live hub setup, the `ports` object and their shutdown entries with `const connections = await connectionsOpen(ENV, "publisher")` (`"worker"` in the Worker), pass `connections` to each `<domain>PortsCreate`, and spread `connections.intakes` and `connections.resources` into the shutdown lists. `pnpm domain-create` and `pnpm piece-remove` handle the new files.
