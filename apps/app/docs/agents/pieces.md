# Pieces of the stack

Read when a Project should remove a piece of the stack it does not use, or take one back. Remove one with `pnpm piece-remove <piece>`.

A piece's code sits mostly in whole files: `src/connections.ts` opens each piece's connection through the piece's own file (`src/redis-open.ts`, `src/cache-store-open.ts`, `src/live-hub-open.ts`, `src/queue-open.ts` (which opens `src/events-open.ts`), `src/analytics-open.ts`, `src/error-tracking-open.ts`), and each Domain tests a piece's behaviour in a file of its own (`use-cases/<domain>-use-cases-<piece>.test.ts`). The rest sits in blocks that run from a `// piece-start: <piece>` line to its `// piece-end: <piece>` line (`#` in YAML and ignore files). Removing a piece deletes those files and blocks, its dependencies, and the imports nothing uses any more. `pnpm domain-create` sees that a piece's package is gone and leaves the piece out of every new Domain.

## How to remove a piece

1. Start clean: `git status` shows nothing to commit. The command refuses otherwise.
2. Run `pnpm piece-remove <piece>` from the Project root, with the piece named under its heading below. It deletes the piece's files and blocks, edits the files that cannot hold markers, removes its packages and the unused imports, and never commits. It refuses an order that cannot work and says what to remove first.
3. Run `pnpm check`, `pnpm test` and `pnpm build`. All three must pass.
4. Commit as "Remove <piece>", alone, so the commit can be reverted later.

A `pnpm template-upgrade` can bring a removed piece's lines back where the Template changed them. Commit the upgrade, run `pnpm piece-remove <piece>` again, and resolve a conflict on a deleted file by keeping it deleted.

## How to add a piece back

`git revert` the "Remove <piece>" commit, run `pnpm install`, then follow the piece's steps below for each Domain created after the removal. Add Redis back before the cache or live updates.

## UI pages

`pnpm piece-remove ui`

The React Router pages, their components and styles, and the Vite dev server. The API, sign-in, live update streams and the Worker stay. Without UI pages, `src/server.ts` serves its Hono app with `@hono/node-server`, Vite builds it into `build/server/index.js` as before, and `pnpm dev` runs it with `node --watch`.

Add the UI pages back: `git revert` the "Remove ui" commit. For each Domain created after it, copy the `*-list.tsx` and `*-detail.tsx` pages and their tests from `apps/app/src/ui/routes/` of the Template release named in `.template.json`, renamed to the Domain, and add their lines at the `domain-create:` markers in `src/ui/routes.ts` and `src/ui/context.ts` and the `context` marker in `src/server.ts`.

## Live updates

`pnpm piece-remove live`

The live update streams (`/live/<domain>/<id>`, `@n8io/baseline-live`) and each Domain's live updates port. Redis stays for the cache; once both are gone, [Redis](#redis) can go too.

Add live updates back: `git revert` the "Remove live" commit. For each Domain created after it, copy every `piece-start: live` block, the `api/*-live.ts` file and its test, and `use-cases/*-use-cases-live.test.ts` from the Domain in `apps/app/src/domains/` of the Template release named in `.template.json`, renamed to the Domain, and add its route at the `live` marker in `src/server.ts`.

## The cache

`pnpm piece-remove cache`

The cache store (`src/cache-store-open.ts`), each Domain's cache port and its adapter (`spi/<domain>-cache.ts`, `spi/<domain>-cached.ts`), the read-through in its get Use case and the clears in its update and delete Use cases. Every get then reads the database. Live updates and Redis stay.

While you keep it: a cached read can be stale. A Use case clears the entry after its change commits, and when that clear is lost (Redis is down, or the process dies first) another process may serve the old value until the entry expires, 60 s by default. For a value that cannot be that stale, pass a shorter `ttlMs` to `cacheCreate` in `spi/<domain>-cache.ts`, or leave it out of the cache. A cache or live update that fails never fails the Use case: the Packages log and count it (`baseline.cache.store_errors`, `baseline.live.sends_failed`), so do not wrap those calls in a catch.

Add the cache back: `git revert` the "Remove cache" commit. For each Domain created after it, copy every `piece-start: cache` block, the `spi/*-cache.ts`, `spi/*-cache.test.ts` and `spi/*-cached.ts` files and `use-cases/*-use-cases-cache.test.ts` from the Domain in `apps/app/src/domains/` of the Template release named in `.template.json`, renamed to the Domain.

## Redis

`pnpm piece-remove redis`

The Redis connection (`@n8io/baseline-redis`, `src/redis-open.ts`), `CACHE_URL` in every env file and Redis in `compose.yaml`. The cache and live updates both run on it, so remove them first; the command refuses while either is installed.

Add Redis back: `git revert` the "Remove redis" commit, before you add back the cache or live updates.

## The queue and the Worker

`pnpm piece-remove queue`

The queue (`@n8io/baseline-queue` on pg-boss), each Domain's Events and its Schedules, and the Worker (`src/worker.ts`, its `compose.yaml` entry and its image entry). Each Domain's transaction becomes a plain Postgres transaction, and its Use cases stop publishing. The API, sign-in, the pages, live updates, the cache and Bridges stay; a Bridge is a read port and runs in the server. A Project with Consumers removes them first; the command refuses while any is left outside a test.

The command also drops the `SCHEDULE_*` overrides from `.env.schema` and takes the Worker out of `pnpm dev`. `pnpm check` then regenerates `src/env.d.ts`.

Add the queue and the Worker back: `git revert` the "Remove queue" commit. For each Domain created after it, copy every `piece-start: queue` block and the `api/*-schedule.ts`, `api/*-schedule.test.ts`, `spi/*-transaction.postgres.test.ts`, `spi/index-queue.test.ts` and `use-cases/*-use-cases-queue.test.ts` files from the Domain in `apps/app/src/domains/` of the Template release named in `.template.json`, renamed to the Domain, and add its schedule at the `schedules` markers in `src/worker.ts` and `src/migrate.ts` and its `SCHEDULE_*` line at the one in `.env.schema`.

## Analytics

`pnpm piece-remove analytics`

Analytics events sent to Mixpanel (`@n8io/baseline-analytics`, `src/analytics-open.ts`), each Domain's analytics port and the calls its Use cases make after commit, and `MIXPANEL_TOKEN` in `.env.schema` and `.env.production`. Nothing else uses it, so it can go in any order.

`MIXPANEL_TOKEN` is optional, so a new Project deploys before it has a Mixpanel project; until it is set, events go to the debug log and are not sent. To send them, add `MIXPANEL_TOKEN=op(op://<project>-production/mixpanel/token)` to `.env.production`.

Add analytics back: `git revert` the "Remove analytics" commit. For each Domain created after it, copy every `piece-start: analytics` block and `use-cases/*-use-cases-analytics.test.ts` from the Domain in `apps/app/src/domains/` of the Template release named in `.template.json`, renamed to the Domain.

## Error tracking

`pnpm piece-remove error-tracking`

Error reports sent to Sentry (`@n8io/baseline-error-tracking`, `src/error-tracking-open.ts`) and `SENTRY_DSN` in `.env.schema` and `.env.production`. Code reports an error by logging it, so no Domain holds any of it, nothing else uses it, and it can go in any order. Errors are still logged after it goes.

It reports what is logged at error or fatal from the moment `src/connections.ts` opens it, and a crash once the composition root has its shutdown handle. A throw before that and `src/migrate.ts` report nothing. The logger decides what reaches it: `LOG_LEVEL=fatal` reports only crashes, and `silent` reports nothing.

`SENTRY_DSN` is optional, so a new Project deploys before it has a Sentry project; until it is set, errors are only logged. To report them, add `SENTRY_DSN=op(op://<project>-production/sentry/dsn)` to `.env.production`.

Add error tracking back: `git revert` the "Remove error-tracking" commit.
