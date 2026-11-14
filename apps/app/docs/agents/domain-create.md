# Adding a Domain with domain-create

Read when adding a Domain. `pnpm domain-create <name>` copies the Template's own Domain under the new name, wires it into the Server, the Worker, the seed and the UI, then runs `pnpm check` and `pnpm test`. It writes no migration and never commits.

## Before you run it

1. Agree the term and add its `**<Term>**:` entry to `CONTEXT.md` first: domain-create refuses a name the glossary does not define. `invoice-line` needs `**Invoice line**:`.
2. Decide what the Domain needs. A Domain that is not plain create, read, update and delete wants `--bare` and only the parts it uses; deleting a full copy costs more than adding a part.

## What each flag writes

| Flag               | Writes                                                                                                                                                                                                                                                                                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)             | Everything below: the same as `--bare` with every part.                                                                                                                                                                                                                                                                                               |
| `--bare`           | The core: the Model (`id`, a unique `name`, `createdBy`, `createdAt`, `updatedAt`, `archivedAt`), ports, errors, the create, get, list, update and delete Use cases with the owner Rules, its `/api/v1` API, the repository (memory, Postgres and the contract test both run), the transaction, and the `<name>.created` and `<name>.deleted` Events. |
| `--analytics`      | Tracking `<name>.created` after commit.                                                                                                                                                                                                                                                                                                               |
| `--cache`          | A read-through cache on get, cleared on update and delete.                                                                                                                                                                                                                                                                                            |
| `--live`           | Live updates to open pages after update and delete, and the `/live/<name>` route.                                                                                                                                                                                                                                                                     |
| `--pages`          | The list and detail pages and their routes; the first Domain with pages also brings back `/`.                                                                                                                                                                                                                                                         |
| `--schedule`       | The stale-archive Schedule: its Use case, Rule, repository method, `SCHEDULE_*` line and Worker wiring. Until a Domain has a Schedule the Worker does not build the Use cases; a Project's first Consumer without one adds that line by hand.                                                                                                         |
| `--seed`           | Development rows, run by `pnpm seed` and by a memory-mode `pnpm dev`.                                                                                                                                                                                                                                                                                 |
| `--reads <domain>` | A reader port, `readers` as the required second argument of `<name>PortsCreate`, a memory fake exported from `spi/index.ts`, the Bridge `src/bridges/<name>-<domain>-reader.ts` and its test, and the wiring in `src/use-cases.ts`. Repeat it for each Domain read. See [bridges.md](bridges.md).                                                     |

`--plural <plural>` names the plural when it is not `<name>s`. A part flag needs `--bare`, and a part whose piece the Project removed (`--pages` without the UI, `--schedule` without the queue) is refused. `--reads` refuses a Domain that does not exist or that already reads the new one.

## What it never writes

Business Rules, Use cases beyond create, get, list, update and delete, Consumers, outcome Events, and the reader's real shape. The Bridge calls the target's `<target>Get` with `<target>Id` and returns its `name`, as domain-create wrote the target; if the target's get or Model has changed since, `pnpm check` fails after the files are written, and you fix the Bridge and its test by hand. Those are the Domain's own design; plan tickets for them, not for what domain-create already wrote. [events.md](events.md) covers Consumers, [bridges.md](bridges.md) outcome Events.

## After it runs

The closing lines list the next steps for the flags used. In short: edit the Model and its table, delete what the Domain does not need, then `pnpm codegen --name <name>_create` writes the migration. A Postgres test of the new table fails until that migration exists.

The Template marks the lines a part owns inside shared files with `domain-create-start: <part>` and `domain-create-end: <part>` comments, which never reach a Project.
