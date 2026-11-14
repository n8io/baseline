# Planning a build of several Domains

Read when you plan work that adds more than one Domain, or split a build into tickets that agents work on at the same time.

## Design up front

AGENTS.md asks you to stop and ask for every new Domain, glossary term, business verb and Event. For a build of several Domains, ask once instead: write a plan that lists each Domain (name and one-line definition), its glossary terms with their `_Avoid_` lists, its business verbs and its Events, and get the user's approval of that list.

- An approved plan answers the stop-and-ask for every term on its list. A term that is not on it still needs its own question.
- Each PR that adds one of those terms says so in its "Glossary" section: the term as agreed, and where the plan was approved (the plan's path or link).
- A change to an approved term is a new question, not a plan edit.

## What domain-create already builds

`pnpm domain-create` writes a whole create, read, update and delete Domain: Model, Rules, Use cases, its `/api/v1` API, repository and Events, plus analytics, cache, live updates, pages, a Schedule and seeds unless you pick parts with `--bare`, and Bridges with `--reads`. [domain-create.md](domain-create.md) lists what each flag writes and what it never writes. Spend tickets on what it does not write: business Rules, the Use cases beyond the five, Consumers, outcome Events and the real reader shapes. A ticket whose Domain is plain create, read, update and delete is a flag on the setup ticket, not a ticket.

## Ticket size

A real Domain with its own Rules, Consumers and pages is 1,100 to 3,000 production lines. Split a larger one by Use case or by Consumer, never by layer: each ticket ships its Use case with its tests, API and adapters.

## Parallel work

Several agents can build Domains at once if the files they share change in one place first:

1. **One serial setup PR.** It adds every agreed term to `CONTEXT.md`, runs `pnpm domain-create` for each Domain in build order (a Domain after the Domains it reads, with `--reads`), shapes each Model and table, and runs `pnpm codegen` once. After it merges, every wiring file (`src/use-cases.ts`, `src/server.ts`, `src/worker.ts`, `src/migrate.ts`, `src/seed.ts`, `src/ui/routes.ts`, `.env.schema`) holds each Domain's lines.
2. **Parallel Domain PRs.** Each one changes only its own `src/domains/<domain>/` folder and, where a Bridge or Consumer is new, the matching wiring lines next to its `domain-create` marker comments. Two PRs that add a line at the same marker conflict on rebase: keep both lines.
3. **Migrations after rebase.** Two PRs that both add a migration conflict by design. The later one deletes its migration folder, rebases and runs `pnpm codegen` again ([data.md](data.md)).
4. **Glossary changes go serial.** A term a Domain PR finds it needs is a question to the user and lands in its own small PR before the Domain PR that uses it.
