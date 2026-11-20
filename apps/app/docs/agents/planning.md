# Planning a build of several bounded contexts

Read when you plan work that adds more than one bounded context, or split a build into tickets that agents work on at the same time.

## Design up front

AGENTS.md asks you to stop and ask for every new context, glossary term, business verb and Domain event. For a build of several contexts, ask once instead: write a plan that lists each context (name, subdomain type and one-line definition), its Aggregates, its glossary terms with their `_Avoid_` lists, its business verbs and its Domain events, and get the user's approval of that list.

- An approved plan answers the stop-and-ask for every term on its list. A term that is not on it still needs its own question.
- Each PR that adds one of those terms says so in its "Glossary" section: the term as agreed, and where the plan was approved (the plan's path or link).
- A change to an approved term is a new question, not a plan edit.

## What context-create and aggregate-create already build

`pnpm aggregate-create` writes a whole create, read, update and delete Aggregate: its schema, transitions and specifications, Use cases, its `/api/v1` API, repository and Events, plus analytics, cache, live updates, pages, a Schedule and seeds unless you pick parts with `--bare`, and `pnpm context-create` writes anti-corruption layers with `--reads`. [context-create.md](context-create.md) lists what each flag writes and what it never writes. Spend tickets on what it does not write: business transitions and specifications, the Use cases beyond the five, Event handlers, sagas and the real shapes ACLs return. A ticket whose Aggregate is plain create, read, update and delete is a flag on the setup ticket, not a ticket.

## Ticket size

A real Aggregate with its own transitions, Event handlers and pages is 1,100 to 3,000 production lines. Split a larger one by Use case or by Event handler, never by layer: each ticket ships its Use case with its tests, API and adapters.

## Parallel work

Several agents can build contexts at once if the files they share change in one place first:

1. **One serial setup PR.** It adds every agreed context to `CONTEXT-MAP.md` and each term to its context's `CONTEXT.md`, runs `pnpm context-create` for each context in build order (a context after the contexts it reads, with `--reads`) and `pnpm aggregate-create` for each of its Aggregates, shapes each Aggregate root and table, and runs `pnpm codegen` once. After it merges, every wiring file (each context's `index.ts`, `src/contexts.ts`, `src/server.ts`, `src/migrate.ts`, `src/seed.ts`, `src/ui/routes.ts`, `.env.schema`) holds each context's lines.
2. **Parallel context PRs.** Each one changes only its own `src/contexts/<context>/` folder and, where an ACL or Event handler is new, the matching wiring lines next to its `wiring:` marker comments. Two PRs that add a line at the same marker conflict on rebase: keep both lines.
3. **Migrations after rebase.** Two PRs that both add a migration conflict by design. The later one deletes its migration folder, rebases and runs `pnpm codegen` again ([data.md](data.md)).
4. **Glossary changes go serial.** A term a context PR finds it needs is a question to the user and lands in its own small PR before the context PR that uses it.
