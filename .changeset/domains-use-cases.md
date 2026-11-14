---
"app": major
---

One place builds every Domain's Use cases. The new `src/use-cases.ts` exports `domainsUseCasesCreate(connections)`, which builds each Domain's traced Use cases in order (a Domain that reads another after it, with its Bridge) and returns `{ fooUseCases, ... }`; `DomainsUseCases` is its type. `src/server.ts`, `src/worker.ts`, `src/seed.ts` and the page tests call it, and `seedsRun` and `uiLoadContextCreate` take `DomainsUseCases`, so no Composition root calls a `*PortsCreate` or wires a Bridge any more. `docs/agents/events-and-bridges.md` is split: `events.md` (Consumers, the Event key, shape changes, Aggregates, unchanged) and a new `bridges.md` (the reader port, `<Domain>Readers` as the required second argument of `<domain>PortsCreate`, the Bridge file named after its export, its memory fake `<domain><Target>ReaderMemoryCreate`, the Bridge test on the target's memory ports, build order, lists, the window between a read and a commit, and Outcome Events). Architecture rule A18 now also checks `src/use-cases.ts`. `domain-create` handles a statement whose every argument names the Domain, and gives a file whose imports all went a blank line after them.

To upgrade a Project: `pnpm template-upgrade` adds `src/use-cases.ts` with its `domains-start`/`domains-end` pair empty, and changes only the markers in `worker.ts` (likely a conflict). `server.ts`, `seed.ts` and `src/ui/context.ts` come through unchanged, because their Domain lines sit inside pairs the render empties, so the Project still compiles in the old shape. Move it to the new one by hand before the next `pnpm domain-create`, which otherwise stops with `missing marker "// domain-create: use-cases"`:

1. In `src/use-cases.ts`, between the pair, paste the skeleton and move each `const <domain>UseCases = telemetryUseCasesTrace(...)` from `server.ts` into it above `// domain-create: use-cases`, in the order the Bridges need, with `<domain>UseCases,` above `// domain-create: use-cases-returned`; add the imports it needs:

   ```ts
   export const domainsUseCasesCreate = (connections: Connections) => {
   	// domain-create: use-cases
   	return {
   		// domain-create: use-cases-returned
   	};
   };
   export type DomainsUseCases = ReturnType<typeof domainsUseCasesCreate>;
   ```

2. `server.ts`: inside its first pair, `const useCases = domainsUseCasesCreate(connections);` and the memory seed becomes `await seedsRun(useCases);`; routes and live routes take `useCases.<domain>UseCases`; `getLoadContext` passes `useCases` between its pair. `worker.ts`: put `// domain-create: domains-start`, `const useCases = domainsUseCasesCreate(connections);` and `// domain-create: domains-end` where the Use cases were built, and call Consumers and Schedules with `useCases.<domain>UseCases`. `seed.ts`: `seedsRun(useCases: DomainsUseCases)`, and its main block's pair holds `await seedsRun(domainsUseCasesCreate(connections));`. `src/ui/context.ts`: `uiLoadContextCreate(c, useCases: DomainsUseCases)` between its pair. Delete every `<domain>PortsCreate` call and copy left in those four files.
3. Delete the markers nothing writes at any more: `// domain-create: bridges`, `seed-context`, `seed-types`, `context-types`, the `context` marker in `server.ts`'s `getLoadContext`, and the `use-cases` markers in `server.ts`, `worker.ts` and `seed.ts`.
4. A Domain that reads another: give its `<domain>PortsCreate` a required second argument `readers: <Domain>Readers` (`Pick<<Domain>Ports, "<domain><Target>Reader">`), name the Bridge file after its export (`src/bridges/<domain>-<target>-reader.ts`), and replace any reader spread into `connections` or defaulted inside `*PortsCreate`. `docs/agents/bridges.md` shows each file.
5. Tests that built `<domain>UseCasesCreate(<domain>PortsCreate(connections))` for pages can use `domainsUseCasesCreate(connections).<domain>UseCases`, which wires the Bridges the same way the Server does; Foo's page tests now do.
