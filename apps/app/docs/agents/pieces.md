# Pieces of the stack

Read when a Project should remove a piece of the stack it does not use, or take one back. Remove one with `pnpm piece-remove <piece>`.

A piece's code sits mostly in whole files: `src/connections.ts` opens each piece's connection through the piece's own file (`src/redis-open.ts`, `src/cache-store-open.ts`, `src/live-hub-open.ts`, `src/queue-open.ts` (which opens `src/events-open.ts`), `src/analytics-open.ts`, `src/error-tracking-open.ts`; the API reference page is `src/api-reference.ts`), and each Domain tests a piece's behaviour in a file of its own (`application/<domain>-use-cases-<piece>.test.ts`). The rest sits in blocks that run from a `// piece-start: <piece>` line to its `// piece-end: <piece>` line (`#` in YAML and ignore files). Removing a piece deletes those files and blocks, its dependencies, and the imports nothing uses any more. `pnpm domain-create` sees that a piece's package is gone and leaves the piece out of every new Domain.

## How to remove a piece

1. Start clean: `git status` shows nothing to commit. The command refuses otherwise.
2. Run `pnpm piece-remove <piece>` from the Project root, with the piece named under its heading below. It deletes the piece's files and blocks (and a test file left with no test), edits the files that cannot hold markers, removes its packages and the unused imports, runs `pnpm check`, and never commits. It refuses an order that cannot work and says what to remove first.
3. Run `pnpm test` and `pnpm build`. Both must pass. Then drop what `README.md` says about the piece: the command does not edit Markdown.
4. Commit as "Remove <piece>", alone, so the commit can be reverted later.

## If it fails

When `pnpm check` fails after the removal, the command undoes it (the tree is as you left it, packages reinstalled), lists the files the check names, and exits 1. Those files use the piece outside its markers. Wrap each piece's code in its own `// piece-start: <piece>` and `// piece-end: <piece>` lines, as the Template does, and run the command again. If you cannot, or this Project keeps the piece, list it in `piecesKept`. When the package manager itself fails (`pnpm remove` or `pnpm add`: registry, network), the command says so, undoes the removal the same way and exits 1; run it again.

Rules for code that belongs to a piece, so the removal stays clean:

- Put it in a whole file named for the piece (`<domain>-use-cases-<piece>.test.ts`, `adapters/outbound/<domain>-<piece>.ts`) where you can, and in blocks only where it shares a file.
- A variable or parameter used only inside a block must be declared inside it, or it is unused once the block goes. An import is never inside a block: piece-remove deletes the imports nothing uses.
- Blocks of different pieces may nest; they may not cross. Biome sorts imports and exports and can pull a block apart: a file with blocks in its exports starts with `// biome-ignore-all assist/source/organizeImports: <why>`. `structure.test.ts` fails on a start without its end, and on blocks that cross.
- Never wrap an import line in markers: Biome sorts imports and would carry one into or out of a block. Add a new import with the imports above the file's first `piece-start:` line, and an import only a piece uses to that piece's own file. When `pnpm format` has pulled a block apart (`structure.test.ts` or piece-remove says the markers do not balance), move the imports it carried back above the first marker and put each `piece-start:` and `piece-end:` line back around the code it held, then run `pnpm format` again and check the blocks are still whole.
- A page that uses live updates carries them in `live` blocks (see the `*-detail.tsx` pages in `src/ui/routes/`), so removing `live` leaves the page.

## Keeping every piece removable

`pnpm piece-check [piece...]` runs `pnpm check` and `pnpm test` on `HEAD` unmodified and, when they fail, reports only "fix the tree first", so a broken tree blames no piece. It removes each installed piece on its own throwaway worktree of `HEAD` and runs `pnpm check` and `pnpm test` on the result, so new code that forgets its markers fails here instead of on the day someone removes the piece. The unmodified tree is checked first, alone, which also fills the pnpm store; then the pieces are checked two at a time (more at once fight over the CPUs and run slower); each piece prints one result line, and a failing piece's output is printed at the end. A check that crashes, is killed (often out of memory), whose install fails or whose removal's `pnpm remove` or `pnpm add` fails (registry error, network) is reported as "could not be checked" and blames no piece: run it again. The `pieces` job of `app-ci.yml` runs it on every pull request, and it is a required check. `redis` is checked after the cache and live updates; `queue` is skipped, with a note, while a Consumer exists.

A Project that will never remove a piece lists it in `.template.json`: `"piecesKept": ["live", "cache"]`. `piece-check` skips it, and new code needs no markers for it. Decide that once, on purpose; the Template's own pieces stay removable.

A Project's own file that belongs to a piece, such as a test of the pages under `test/ui` or an integration test of analytics, is listed in `.template.json` too, so `pnpm piece-remove` and `piece-check` delete it with the piece: `"pieceFiles": { "ui": ["test/ui"], "analytics": ["test/integration/observability-analytics.test.ts"] }`. Paths are from the Project root and tracked by git (the undo of a failed removal restores only tracked files); a folder goes whole. List them there, never in `scripts/piece-remove.ts`: the Template owns that script, so each release that changes that script conflicts with lines you added to it, and a Template script copied over yours drops them. An unknown piece or a path outside the Project makes both commands stop and say which entry is wrong.

`pnpm template-upgrade` renders both releases with the pieces this Project removed already removed (found by their missing package in `package.json`), so a removed piece's package, files and lines do not come back. If a piece's lines still conflict, commit the upgrade, run `pnpm piece-remove <piece>` again, and resolve a conflict on a deleted file by keeping it deleted.

## How to add a piece back

`git revert` the "Remove <piece>" commit, run `pnpm install`, then follow the piece's steps below for each Domain created after the removal. Add Redis back before the cache or live updates.

## UI pages

`pnpm piece-remove ui`

The React Router pages, their components and styles, and the Vite dev server. The API, sign-in, live update streams and the Worker stay. Without UI pages, `src/server.ts` serves its Hono app with `@hono/node-server`, Vite builds it into `build/server/index.js` as before, and `pnpm dev` runs it with `node --watch`.

Add the UI pages back: `git revert` the "Remove ui" commit. For each Domain created after it, copy the `*-list.tsx` and `*-detail.tsx` pages and their tests from `apps/app/src/ui/routes/` of the Template release named in `.template.json`, renamed to the Domain, and add their lines at the `domain-create:` markers in `src/ui/routes.ts` and `src/ui/context.ts`.

## Live updates

`pnpm piece-remove live`

The live update streams (`/live/<domain>/<id>`, `@n8io/baseline-live`) and each Domain's live updates port. Redis stays for the cache; once both are gone, [Redis](#redis) can go too.

Add live updates back: `git revert` the "Remove live" commit. For each Domain created after it, copy every `piece-start: live` block, the `adapters/inbound/*-live.ts` file and its test, and `application/*-use-cases-live.test.ts` from the Domain in `apps/app/src/contexts/` of the Template release named in `.template.json`, renamed to the Domain, and add its route at the `live` marker in `src/server.ts`.

## The cache

`pnpm piece-remove cache`

The cache store (`src/cache-store-open.ts`), each Domain's cache port and its adapter (`adapters/outbound/<domain>-cached.ts`), the read-through in its get Use case and the clears in its update and delete Use cases. Every get then reads the database. Live updates and Redis stay.

While you keep it: a cached read can be stale. A Use case clears the entry after its change commits, and when that clear is lost (Redis is down, or the process dies first) another process may serve the old value until the entry expires, 60 s by default. For a value that cannot be that stale, pass a shorter `ttlMs` to `cacheCreate` in `adapters/outbound/index.ts`, or leave it out of the cache. A cache or live update that fails never fails the Use case: the Packages log and count it (`baseline.cache.store_errors`, `baseline.live.sends_failed`), so do not wrap those calls in a catch.

Add the cache back: `git revert` the "Remove cache" commit. For each Domain created after it, copy every `piece-start: cache` block, the `adapters/outbound/*-cached.ts` file and its test and `application/*-use-cases-cache.test.ts` from the Domain in `apps/app/src/contexts/` of the Template release named in `.template.json`, renamed to the Domain.

## Redis

`pnpm piece-remove redis`

The Redis connection (`@n8io/baseline-redis`, `src/redis-open.ts`), `CACHE_URL` and `REDIS_HOST_PORT` in the env files, and Redis in `compose.yaml`. The cache and live updates both run on it, so remove them first; the command refuses while either is installed.

Add Redis back: `git revert` the "Remove redis" commit, before you add back the cache or live updates.

## The queue and the Worker

`pnpm piece-remove queue`

The queue (`@n8io/baseline-queue` on pg-boss), each Domain's Events and its Schedules, the Worker (`src/worker.ts`, its `compose.yaml` entry and its image entry), and the `blocked-keys` command (`src/blocked-keys.ts`). Each Domain's transaction becomes a plain Postgres transaction, and its Use cases stop publishing. The API, sign-in, the pages, live updates, the cache and Bridges stay; a Bridge is a read port and runs in the server. A Project with Consumers removes them first; the command refuses while any is left outside a test.

The command also drops the `SCHEDULE_*` overrides from `.env.schema`, takes the Worker out of `pnpm dev` and drops the `blocked-keys` script. `pnpm check` then regenerates `src/env.d.ts`.

Add the queue and the Worker back: `git revert` the "Remove queue" commit. For each Domain created after it, copy every `piece-start: queue` block and the `adapters/inbound/*-schedule.ts`, `adapters/inbound/*-schedule.test.ts`, `adapters/outbound/*-transaction.postgres.test.ts`, `adapters/outbound/index-queue.test.ts` and `application/*-use-cases-queue.test.ts` files from the Domain in `apps/app/src/contexts/` of the Template release named in `.template.json`, renamed to the Domain, and add its schedule at the `schedules` markers in `src/worker.ts` and `src/migrate.ts` and its `SCHEDULE_*` line at the one in `.env.schema`.

## Analytics

`pnpm piece-remove analytics`

Analytics events sent to Mixpanel (`@n8io/baseline-analytics`, `src/analytics-open.ts`), each Domain's analytics port and the calls its Use cases make after commit, and `MIXPANEL_TOKEN` in `.env.schema` and `.env.production`. Nothing else uses it, so it can go in any order.

`MIXPANEL_TOKEN` is optional, so a new Project deploys before it has a Mixpanel project; until it is set, events go to the debug log and are not sent. To send them, add `MIXPANEL_TOKEN=infisical()` to `.env.production` and a `MIXPANEL_TOKEN` secret to the Infisical project.

Add analytics back: `git revert` the "Remove analytics" commit. For each Domain created after it, copy every `piece-start: analytics` block and `application/*-use-cases-analytics.test.ts` from the Domain in `apps/app/src/contexts/` of the Template release named in `.template.json`, renamed to the Domain.

## Error tracking

`pnpm piece-remove error-tracking`

Error reports sent to Sentry (`@n8io/baseline-error-tracking`, `src/error-tracking-open.ts`) and `SENTRY_DSN` in `.env.schema` and `.env.production`. Code reports an error by logging it, so no Domain holds any of it, nothing else uses it, and it can go in any order. Errors are still logged after it goes.

It reports what is logged at error or fatal from the moment `src/connections.ts` opens it, and a crash once the composition root has its shutdown handle. A throw before that and `src/migrate.ts` report nothing. The logger decides what reaches it: `LOG_LEVEL=fatal` reports only crashes, and `silent` reports nothing.

`SENTRY_DSN` is optional, so a new Project deploys before it has a Sentry project; until it is set, errors are only logged. To report them, add `SENTRY_DSN=infisical()` to `.env.production` and a `SENTRY_DSN` secret to the Infisical project.

Add error tracking back: `git revert` the "Remove error-tracking" commit.

## API reference

`pnpm piece-remove api-reference`

The interactive API reference at `/api/v1/docs`: Swagger UI (`swagger-ui-dist`, named only in `src/api-reference.ts`) served from this app's own origin and reading `/api/v1/openapi.json`. Its Authorize button takes a bearer token, which the OpenAPI document declares in base code, so the document keeps its `bearer` scheme after the piece goes. The page and its two files answer without a token, in every environment, like the document; the exemption in `server.ts`'s "no Actor, no API" guard stays, so without the piece `/api/v1/docs` is the API's JSON 404. The command also drops the `@scarf/scarf` line from `pnpm-workspace.yaml`. Nothing else uses it, so it can go in any order.

The page works under the Template's CSP unchanged: both script tags carry the request's nonce. Swagger UI's two `data:` icons stay blocked by `default-src`; do not loosen `img-src` for them.

Add the API reference back: `git revert` the "Remove api-reference" commit.

## The SDK

`pnpm piece-remove sdk`

The typed TypeScript SDK in `clients/sdk`, a package of its own (`<project>-sdk`) beside the app in the pnpm workspace: one function per API operation, named by its operationId (`invoiceCreate(body)`), each resolving to `{ status, data, headers }` typed by status. A caller sets the API's URL and a token once with `sdkConfigure({ baseUrl, token })`, and may pass either for one call as the function's last argument; it installs no runtime dependency. The `sdk-generate` script (`scripts/sdk-generate.ts`, the one file that names the generator, orval) writes `clients/sdk/openapi.json` from the app's document and `clients/sdk/sdk.ts` from that; `sdk-fetch.ts` is the hand-written fetch they call. Run it after any route change and after adding an Aggregate's routes; CI's `check` job fails while the committed files are stale. The image never holds `clients/` (`.dockerignore`). The command also drops the `sdk-generate` script and the `esbuild` line and the workspace `packages:` block from `pnpm-workspace.yaml`. Nothing else uses it, so it can go in any order.

Add the SDK back: `git revert` the "Remove sdk" commit, then run the `sdk-generate` script.
