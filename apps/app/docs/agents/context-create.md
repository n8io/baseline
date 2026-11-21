# Adding a context and its Models

Read when adding a bounded context, a Model, a Seed, or a model function or Use case to an existing Model. Two commands copy the Template's own context under new names. Neither writes a migration or commits.

- `pnpm context-create <context>` writes the context's shell: `src/contexts/<context>/` with its `index.ts` (`<context>ContextCreate` and its Public contract), ports, transaction, Use cases entry, outbound adapters' entry, errors, repositories file and its `CONTEXT.md` (an empty `## Language`), and its wiring into `src/contexts.ts` and the entry points. It has no Model yet, so `pnpm check` fails until it has one. It formats and runs no check.
- `pnpm model-create <context> <model>` adds a Model to that context: the Template Model's files under the new name, its lines in the context's shared files and in the entry points and UI, then the `sdk-generate` script when the Project has the SDK (its new routes would leave it stale), `pnpm check` and `pnpm test`. A context's first Model is often named after the context (`invoice invoice`).

## Before you run them

1. Agree the context's name and add its row to `CONTEXT-MAP.md` (format below): `context-create` refuses a context the map does not list. It writes `src/contexts/<context>/CONTEXT.md` with an empty `## Language`.
2. Agree each Model's term and add its `**<Term>**:` entry under that `## Language`: `model-create` refuses a name the context's glossary does not define. `invoice-line` needs `**Invoice line**:`.
3. Decide what each Model needs. One that is not plain create, read, update and delete wants `--bare` and only the options it uses; deleting a full copy costs more than adding an option.

## The context map

`CONTEXT-MAP.md` holds two tables. `pnpm test` checks them against `src/contexts/`, and `pnpm glossary-check` reads every glossary they name.

```md
## Contexts

| Context   | Language                          |
| --------- | --------------------------------- |
| `billing` | `src/contexts/billing/CONTEXT.md` |
| `catalog` | `src/contexts/catalog/CONTEXT.md` |

## Relationships

| Downstream | Upstream  | Through            |
| ---------- | --------- | ------------------ |
| `billing`  | `catalog` | ACL, Domain events |
```

- Language: the context's own `CONTEXT.md`, as a link or a path. Run `pnpm format` after editing the map: `pnpm check` fails on an unaligned table.
- A relationship row names the downstream context, the upstream it depends on, and how: `ACL` (it reads the upstream through an anti-corruption layer), `Domain events` (it handles the upstream's), or both. Both go through the upstream's Public contract. The Shared kernel needs no row.
- A file in a context uses its own terms and `CONTEXT.md`'s. Another context's term is a `glossary-check` hit, except in the `adapters/` of a context downstream of it, anywhere in a context with an ACL to it, and where the context's own `CONTEXT.md` uses the term. An `_Avoid_` alias written capitalized (`DTO`) matches only as written; write a plain word in lower case (`service`).

## What each flag writes

`context-create` takes one flag:

| Flag                | Writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--reads <context>` | An anti-corruption layer `adapters/outbound/<context>-<upstream>-acl.ts` and its test, its slot `<context><Upstream>Acl` in `application/ports.ts`, `upstream` as the required argument of `<context>ContextCreate`, `<context>PortsCreate` and `<context>PortsMemoryCreate`, the test helper `<context>TestUpstreamCreate` that builds the real upstream on memory adapters, and the wiring in `src/contexts.ts`. Repeat it for each context read. See [acl.md](acl.md). |

`model-create` takes the options:

| Flag          | Writes                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)        | Everything below: the same as `--bare` with every option.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `--bare`      | The core: the Model (`id`, a unique `name`, `createdBy`, `createdAt`, `updatedAt`, `archivedAt`), its repository port and table, errors, the create, get, list, update and delete Use cases with the owner predicates (`<model>CanUpdate`, `<model>CanDelete`) and the `<model>New` and `<model>Rename` model functions, its `/api/v1` API, the repository (memory, Postgres and the contract test both run), and the `<model>.created` and `<model>.deleted` Events. |
| `--analytics` | Tracking `<model>.created` after commit.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `--cache`     | A read-through cache on get, cleared on update and delete.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `--live`      | Live updates to open pages after update and delete, and the `/live/<model>` route.                                                                                                                                                                                                                                                                                                                                                                                    |
| `--pages`     | The list and detail pages and their routes; the first Model with pages also brings back `/` and the context's UI key.                                                                                                                                                                                                                                                                                                                                                 |
| `--schedule`  | The stale-archive Schedule: its Use case, cut-off (`<model>StaleBefore`), repository method, `SCHEDULE_*` line and its entry in the context's `schedules`.                                                                                                                                                                                                                                                                                                            |
| `--seed`      | Development rows, run by `pnpm seed` and by a memory-mode `pnpm dev`.                                                                                                                                                                                                                                                                                                                                                                                                 |

`--plural <plural>` names the plural when it is not `<name>s`. An option flag needs `--bare`, and an option whose piece the Project removed (`--pages` without the UI, `--schedule` without the queue) is refused. `--reads` refuses a context that does not exist or that already reads the new one; `model-create` refuses a context that does not exist.

## Seeds

A Seed (`--seed`) is development data, never a script: `pnpm seed` runs `src/seed.ts`, which runs every context's `seeds` in the order `contextsCreate` returns the contexts, so an upstream's seeds run first.

- An `<model>Seed` ensures each development row by its natural key (create, and when the Use case answers that the key is taken, read the row that holds it) and returns every row it ensured, so it converges from an empty, half-seeded or seeded database. The context's `index.ts` lists it in `seeds`.
- Seeds that need each other's rows go in one entry that awaits them in order: `async (actor) => { const invoices = await invoiceSeed(useCases, actor); await invoiceLineSeed({ invoices, useCases }, actor); }`.
- A seed that needs another context's rows (an invoice's customers) gets the upstream from `index.ts`, where `upstream` is in scope: `(actor: Actor) => invoiceSeed({ upstream, useCases }, actor)`. It types it with the upstream's `<Upstream>Context` from that context's `index.ts` (A6 allows the type import for a context it has an ACL for, [acl.md](acl.md)) and lists the rows through the upstream's `*List` Use case.
- A seed that stores another context's ids must tolerate a row it seeded earlier still holding an id that no longer exists: there are no foreign keys between contexts, and a row deleted and seeded again comes back with a new id. Replace or skip the stale id rather than letting a Use case error stop `pnpm seed`.

## Several Models in one context

Each Model gets its own file (`domain/<model>.ts`, its schema, model functions), table (`adapters/outbound/<model>-table.ts`, which is how the checks tell a Model from a projection), repository, Use cases and routes; only the context's first table exports its `pgSchema`, because drizzle-kit refuses two exported schemas of one name. They share the context's ports, transaction, Use cases object and memory state. One transaction writes one Model. A Use case that must change two of the same context's Models together (deleting an invoice with its lines) says why in a `// invariant: <what>` comment above the transaction; architecture rule A28 fails without it. Across contexts, use an Event ([events.md](events.md)).

## Model functions

A Model changes only through its model functions, in `domain/<model>.ts` beside its schema. A model function is pure: it takes the Model and an input object holding the Actor and the time (`now` from the Use case's Clock), and returns `Result<Model, Error>`, so the check a change needs (a predicate such as `invoiceCanUpdate`) cannot be skipped. A new Model comes from `<model>New`, because `<model>Create` is its Use case; it returns the Model itself when nothing can refuse it (`invoiceNew`) and a `Result` when something can (`invoiceLineNew`, given the invoice it joins). A delete has no model function: its Use case checks the predicate (`invoiceCanDelete`). The Use case loads the Model, calls the model function, saves the value it returns and publishes; architecture rule A29 fails a Use case that builds or spreads the Model itself. When a model function shares its Use case's verb (`invoiceLineCustomerAssign`), the Use case file imports it with `as <verb>Model function`. A test of `domain/<model>.ts` covers only what no Use case test does.

## What they never write

Business model functions, Use cases beyond create, get, list, update and delete, Event handlers, sagas, and the real shape an ACL returns. The ACL calls the upstream's `<upstream>Get` with `<upstream>Id` and returns its `name`, as the upstream was first written; if the upstream's get or Model has changed since, `pnpm check` fails after the files are written, and you fix the ACL and its test by hand. Those are the context's own design; plan tickets for them, not for what the commands already wrote. [events.md](events.md) covers Event handlers, [acl.md](acl.md) sagas.

## After they run

The closing lines list the next steps for the flags used. In short: edit the Model and its table, delete what the Model does not need, then `pnpm codegen --name <model>_create` writes the migration. A Postgres test of the new table fails until that migration exists.

The shared files mark where the commands add lines with `// wiring: <slot>` comments (`# wiring:` in `.env.schema`). The Template marks the lines an option owns inside shared files with `model-create-start: <option>` and `model-create-end: <option>` comments, which never reach a Project.
