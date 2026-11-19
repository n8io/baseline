# Adding a context and its Aggregates

Read when adding a bounded context or an Aggregate to one. Two commands copy the Template's own example context under new names. Neither writes a migration or commits.

- `pnpm context-create <context>` writes the context's shell: `src/contexts/<context>/` with its `index.ts`, ports, transaction, Use cases entry, adapters' entries, errors, repositories file and a `CONTEXT.md` stub, and its wiring into `src/use-cases.ts` and the composition roots. It has no Aggregate yet, so `pnpm check` fails until it has one. It formats and runs no check.
- `pnpm aggregate-create <context> <aggregate>` adds an Aggregate to that context: the example Aggregate's files under the new name, its lines in the context's shared files and in the composition roots and UI, then `pnpm check` and `pnpm test`. A context's first Aggregate is often named after the context (`invoice invoice`).

## Before you run them

1. Agree each term and add its `**<Term>**:` entry to `CONTEXT.md` first: both commands refuse a name the glossary does not define. `invoice-line` needs `**Invoice line**:`.
2. Decide what each Aggregate needs. One that is not plain create, read, update and delete wants `--bare` and only the parts it uses; deleting a full copy costs more than adding a part.

## What each flag writes

`context-create` takes one flag:

| Flag                | Writes                                                                                                                                                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--reads <context>` | A reader port, `readers` as the required second argument of `<context>PortsCreate`, a memory fake exported from `adapters/outbound/index.ts`, the Bridge `src/bridges/<context>-<target>-reader.ts` and its test, and the wiring in `src/use-cases.ts`. Repeat it for each context read. See [bridges.md](bridges.md). |

`aggregate-create` takes the parts:

| Flag          | Writes                                                                                                                                                                                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)        | Everything below: the same as `--bare` with every part.                                                                                                                                                                                                                                                                                                                |
| `--bare`      | The core: the Model (`id`, a unique `name`, `createdBy`, `createdAt`, `updatedAt`, `archivedAt`), its repository port and table, errors, the create, get, list, update and delete Use cases with the owner Rules, its `/api/v1` API, the repository (memory, Postgres and the contract test both run), and the `<aggregate>.created` and `<aggregate>.deleted` Events. |
| `--analytics` | Tracking `<aggregate>.created` after commit.                                                                                                                                                                                                                                                                                                                           |
| `--cache`     | A read-through cache on get, cleared on update and delete.                                                                                                                                                                                                                                                                                                             |
| `--live`      | Live updates to open pages after update and delete, and the `/live/<aggregate>` route.                                                                                                                                                                                                                                                                                 |
| `--pages`     | The list and detail pages and their routes; the first Aggregate with pages also brings back `/` and the context's UI key.                                                                                                                                                                                                                                              |
| `--schedule`  | The stale-archive Schedule: its Use case, Rule, repository method, `SCHEDULE_*` line and Worker wiring. Until an Aggregate has a Schedule the Worker does not build the Use cases; a Project's first Consumer without one adds that line by hand.                                                                                                                      |
| `--seed`      | Development rows, run by `pnpm seed` and by a memory-mode `pnpm dev`.                                                                                                                                                                                                                                                                                                  |

`--plural <plural>` names the plural when it is not `<name>s`. A part flag needs `--bare`, and a part whose piece the Project removed (`--pages` without the UI, `--schedule` without the queue) is refused. `--reads` refuses a context that does not exist or that already reads the new one; `aggregate-create` refuses a context that does not exist.

A seed that stores another context's ids must tolerate a row it seeded earlier still holding an id that no longer exists: there are no foreign keys between contexts, and a row deleted and seeded again comes back with a new id. Replace or skip the stale id rather than letting a Use case error stop `pnpm seed`.

## Several Aggregates in one context

Each Aggregate gets its own Model, table, repository, Use cases and routes; they share the context's ports, transaction, Use cases object and memory state. One transaction writes one Aggregate. A Use case that must change two of the same context's Aggregates together (deleting an invoice with its lines) says why in a `// invariant: <what>` comment above the transaction; architecture rule A28 fails without it. Across contexts, use an Event ([events.md](events.md)).

## What they never write

Business Rules, Use cases beyond create, get, list, update and delete, Consumers, outcome Events, and the reader's real shape. The Bridge calls the target's `<target>Get` with `<target>Id` and returns its `name`, as the target was first written; if the target's get or Model has changed since, `pnpm check` fails after the files are written, and you fix the Bridge and its test by hand. Those are the context's own design; plan tickets for them, not for what the commands already wrote. [events.md](events.md) covers Consumers, [bridges.md](bridges.md) outcome Events.

## After they run

The closing lines list the next steps for the flags used. In short: edit the Model and its table, delete what the Aggregate does not need, then `pnpm codegen --name <aggregate>_create` writes the migration. A Postgres test of the new table fails until that migration exists.

The shared files mark where the commands add lines with `// wiring: <slot>` comments (`# wiring:` in `.env.schema`). The Template marks the lines a part owns inside shared files with `aggregate-create-start: <part>` and `aggregate-create-end: <part>` comments, which never reach a Project.
