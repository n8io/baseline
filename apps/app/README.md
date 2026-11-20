# app

**A starter app with the layout and patterns every Project made from baseline shares.**

<sub>The [baseline](https://github.com/n8io/baseline) Template. `pnpm app-create` renders it into a new Project, whose README gets the Project's name and description and names the release it was made from.</sub>

<p><img src="https://raw.githubusercontent.com/n8io/baseline/main/docs/readme/app-flow.svg" width="880" alt="A write and its Domain event, end to end: a request runs through a context's HTTP route, Use case, Repository and Postgres adapter into one transaction that commits the row and its Domain event; the Worker delivers each Domain event, one at a time per Event key in commit order, to another context's Event handler, whose Use case records it in the Inbox so a repeat is skipped."></p>

## Start

```sh
fnm use && pnpm install
pnpm dev
```

`pnpm dev` starts the database and the cache in Docker, migrates, seeds, then runs the Worker beside the dev server: open the URL it prints. Each linked git worktree runs its own copy, with its own containers, data, ports and URL. Development signs in through a memory issuer and reads plain values from `.env.development`, so it needs no identity provider and no secrets.

**Needs** Node 26 ([fnm](https://github.com/Schniz/fnm) reads `.node-version`), the pnpm that `packageManager` names, and Docker.

## What runs

| Part     | What it does                                                                                                                               | Runs on            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| Server   | The API under `/api/v1`, its OpenAPI document (`/api/v1/openapi.json`) and reference page (`/api/v1/docs`), the UI pages, and live updates | Hono, React Router |
| Worker   | Event handlers, which get each Domain event once it commits, in order per Event key, and Schedules                                         | pg-boss            |
| Database | Every bounded context's tables, and the Domain events waiting for the Worker                                                               | Postgres 18        |
| Cache    | The read-through cache, and the fan-out of live updates to every Server                                                                    | Redis 8            |

Every request is one trace through each Event it publishes; `compose.yaml`'s `telemetry` profile adds a local trace and log viewer on `localhost:3001` (how is at the top of that file). The UI pages, live updates, the cache, Redis, the queue, analytics, error reports and the API reference are pieces: `pnpm piece-remove <piece>` takes out one this Project does not use (then drop what this README says about it), and `pnpm piece-check` proves each still can.

## Bounded contexts

A bounded context is a folder in `src/contexts/` holding one or more Aggregates, each with its HTTP routes, Use cases, transitions, ports and adapters in the same layout, listed with its subdomain type in [CONTEXT-MAP.md](CONTEXT-MAP.md) and named by the terms in its own `CONTEXT.md`. The contexts are the folders there; a new Project starts with none. Agree the context and add its row to the map, then:

```sh
pnpm context-create invoice                 # then add **Invoice**: to src/contexts/invoice/CONTEXT.md
pnpm aggregate-create invoice invoice --bare   # the core only; --help lists the parts
pnpm codegen --name invoice_create  # its migration, after you shape the Aggregate root and its table
```

## Commands

| I want to…                                    | Run                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| run the app, the Worker and their services    | `pnpm dev`                                                                     |
| wipe the local database and cache data        | `pnpm dev:reset`                                                               |
| remove the dev instances of removed worktrees | `pnpm dev:prune` (`--dry-run` lists them)                                      |
| lint, check formatting and typecheck          | `pnpm check`                                                                   |
| format                                        | `pnpm format`                                                                  |
| run the unit tests, on memory adapters        | `pnpm test`                                                                    |
| run the integration tests (`pnpm dev` first)  | `pnpm test:integration`                                                        |
| run most of CI before I push                  | `pnpm run ci`                                                                  |
| add a context, then an Aggregate              | `pnpm context-create <context>`, `pnpm aggregate-create <context> <aggregate>` |
| write a migration after a table change        | `pnpm codegen`                                                                 |
| migrate or seed by hand                       | `pnpm migrate`, `pnpm seed`                                                    |
| list or release a blocked Event key           | `pnpm blocked-keys`                                                            |
| catch a breaking API change                   | `pnpm api-check`                                                               |
| remove a piece, or prove each still comes out | `pnpm piece-remove <piece>`, `pnpm piece-check`                                |
| take a newer Template release                 | `pnpm template-upgrade`                                                        |
| find glossary aliases                         | `pnpm glossary-check`                                                          |
| build for production                          | `pnpm build`                                                                   |

## For AI agents

Read [AGENTS.md](AGENTS.md) first: it holds the commands, the rules and where new work goes, and loads [CONTEXT.md](CONTEXT.md), the shared glossary; [CONTEXT-MAP.md](CONTEXT-MAP.md) links each context's own. Task rules live in [docs/agents/](docs/agents/), and AGENTS.md says when to read each one.
