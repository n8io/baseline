# baseline

A template for TypeScript projects. It has three parts:

- The shared `@n8io/baseline-*` packages.
- The `apps/app` template that new projects are made from.
- The CI workflow every project runs.

Each project gets a domain-driven Hono API and React Router pages in one process, a Worker for events and schedules, Postgres, Redis, OpenTelemetry and 1Password secrets.

```mermaid
flowchart LR
  subgraph baseline
    P["packages/*"] -->|release| GP[("npmjs<br/>@n8io/baseline-*")]
    T["apps/app"] -->|release| R["app@x.y.z tag"]
    W["app-ci.yml"] -->|tag| V6["v6"]
  end
  R -->|app-create| Y["your project"]
  R -->|pnpm template-upgrade| Y
  GP -->|pnpm install| Y
  V2 -->|CI on every PR| Y
```

## Quick start

> [!NOTE]
> You need Node 26 ([fnm](https://github.com/Schniz/fnm) reads `.node-version`), pnpm 12 (the exact version is in `packageManager`), Docker, and the [GitHub CLI](https://cli.github.com) logged in, which `app-create` uses to create the project's repo (`--no-github` skips it).

**1. Create a project.** This renders the latest `app@` release with no Domain yet, creates a private GitHub repo with a CI ruleset, and runs CI once on main.

```sh
git clone https://github.com/n8io/baseline && cd baseline
fnm use && pnpm install
pnpm app-create
```

It asks two questions. You can pass them as flags instead: `--name --description [--owner]`. [`docs/agents/project-create.md`](docs/agents/project-create.md) walks through it, including `--no-github` and `--github-only`.

**2. Run it.**

```sh
cd <your-project>
pnpm dev   # starts Postgres 18 and Redis 8, migrates, seeds, then runs the Worker and the dev server
```

Open the URL `pnpm dev` prints. The Worker restarts when a file it imports changes. Development uses a memory sign-in, so no identity provider is needed.

## In a project

| Task                                                  | Command                     |
| ----------------------------------------------------- | --------------------------- |
| Lint, format check and typecheck                      | `pnpm check`                |
| Unit tests (memory adapters)                          | `pnpm test`                 |
| Integration tests (needs `docker compose up -d`)      | `pnpm test:integration`     |
| Everything CI runs                                    | `pnpm run ci`               |
| Add a Domain                                          | `pnpm domain-create <name>` |
| Generate a migration after editing a `spi/*-table.ts` | `pnpm codegen`              |
| Pull the newest template release                      | `pnpm template-upgrade`     |

A project that does not need UI pages or live updates removes them with the steps in [`docs/agents/pieces.md`](apps/app/docs/agents/pieces.md).

The project's own [`AGENTS.md`](apps/app/AGENTS.md) holds the rules every task needs: where new work goes, secrets rules, and when to stop and ask. It links the task-specific rules in [`docs/agents/`](apps/app/docs/agents/), which an agent reads only when the task needs them.

> [!TIP]
> `pnpm template-upgrade` does a 3-way merge between the release your project came from and the newest one. Resolve every conflict marker before you commit.

## Packages

Projects depend on these. They are public on npmjs, so `pnpm add @n8io/baseline-<name>` needs no registry setup. Each package's README lists its exports, an example, and the env vars and peers it needs.

| Package                                     | What it does                                             |
| ------------------------------------------- | -------------------------------------------------------- |
| [`analytics`](packages/analytics)           | Analytics events to Mixpanel, sent without blocking      |
| [`authn`](packages/authn)                   | OIDC code flow, JWT verification and the Actor           |
| [`cache`](packages/cache)                   | Typed cache on any store (Redis or memory)               |
| [`error-tracking`](packages/error-tracking) | Error reports to Sentry, linked to their trace           |
| [`health`](packages/health)                 | `/livez` and `/readyz` probes                            |
| [`http`](packages/http)                     | Hono error handling and helpers                          |
| [`id`](packages/id)                         | Prefixed TypeIDs, to and from UUIDs                      |
| [`live`](packages/live)                     | Live updates over SSE and Redis pub/sub                  |
| [`logger`](packages/logger)                 | The one pino logger                                      |
| [`postgres`](packages/postgres)             | Pool, transactions, migrations and id columns on Drizzle |
| [`queue`](packages/queue)                   | pg-boss Events, Consumers and Schedules with an inbox    |
| [`redis`](packages/redis)                   | One Redis connection the cache and live updates share    |
| [`result`](packages/result)                 | `Result`, `ok` and `err` for expected business errors    |
| [`shutdown`](packages/shutdown)             | Graceful shutdown in order                               |
| [`telemetry`](packages/telemetry)           | OpenTelemetry preload and use-case spans                 |

## Working on baseline

```sh
fnm use && pnpm install
pnpm turbo run check test build   # the full CI-equivalent
```

Docker must be running: the root tests and the `cache`, `live`, `postgres`, `queue` and `redis` tests start their own containers.

A change that should ship needs a changeset. Run `pnpm changeset` and pick the packages it touches, plus `app` for template changes. On merge, a "Version packages" PR opens. Merging that PR publishes the packages, tags `app@x.y.z`, and moves `v6`.

Dependabot opens update PRs weekly, for releases at least 7 days old. Patch and minor updates come grouped in one PR that merges itself once CI passes; each major is its own PR to review and merge by hand. Update PRs carry no changeset, so they never publish. Add one to a major only if it should ship.

> [!WARNING]
> `v6` is the current major of `app-ci.yml`; `v1` to `v5` stay frozen. `v6` never gains a check that can fail on projects that passed before. A change like that ships as `v7`.

## For AI agents

Start with these files, in this order:

1. [`AGENTS.md`](AGENTS.md): this repo's verify commands and test rules.
2. [`CONTEXT-MAP.md`](CONTEXT-MAP.md): the glossaries. Use their terms in code, tests, PRs and commits.
3. [`apps/app/AGENTS.md`](apps/app/AGENTS.md) and [`apps/app/CONTEXT.md`](apps/app/CONTEXT.md): the rules and terms every project inherits.

```text
.github/workflows/  ci.yml (this repo), app-ci.yml (called by projects), release.yml
apps/app/           the template: src/domains/foo is the example Domain
packages/*          the @n8io/baseline-* packages
scripts/            app-create.ts
test/               app-create tests and the render-and-test check
```

## License

[MIT](LICENSE). Report vulnerabilities as [`SECURITY.md`](SECURITY.md) describes.
