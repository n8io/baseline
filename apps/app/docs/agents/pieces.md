# Pieces of the stack

Read when a Project should remove a piece of the stack it does not use, or take one back. Ask your agent: "Remove the UI pages with docs/agents/pieces.md."

A piece's code sits in whole files and in blocks that run from a `// piece-start: <piece>` line to its `// piece-end: <piece>` line (`#` in YAML and ignore files). Removing a piece deletes those files and blocks, its dependencies, and the imports nothing uses any more. `pnpm domain-create` sees that a piece's package is gone and leaves the piece out of every new Domain.

## How to remove a piece

1. Start clean: `git status` shows nothing to commit.
2. Run the piece's block below from the Project root, as it stands. Each line is one step; stop at the first that fails.
3. Run `pnpm check`, `pnpm test` and `pnpm build`. All three must pass.
4. Commit as "Remove <piece>", alone, so the commit can be reverted later.
5. Run `git grep -nE '^[[:space:]]*(//|#) piece-start: <piece>$'`. It finds nothing.

A `pnpm template-upgrade` can bring a removed piece's lines back where the Template changed them. Delete them again by step 2's block-removal line, and resolve a conflict on a deleted file by keeping it deleted.

## UI pages

The React Router pages, their components and styles, and the Vite dev server. The API, sign-in, live update streams and the Worker stay. Without UI pages, `src/server.ts` serves its Hono app with `@hono/node-server`, Vite builds it into `build/server/index.js` as before, and `pnpm dev` runs it with `node --watch`.

```sh
rm -r src/ui public components.json react-router.config.ts src/server-hmr.test.ts test/integration/csp-nonce.ts
perl -0pi -e 's{^[ \t]*(//|#) piece-start: ui\n.*?^[ \t]*(//|#) piece-end: ui\n}{}gms' $(git grep -l 'piece-start: ui' -- ':!*.md')
node -e 'const fs = require("node:fs"); const b = JSON.parse(fs.readFileSync("biome.json", "utf8")); delete b.css; b.files.includes = b.files.includes.filter((p) => p !== "!.react-router"); fs.writeFileSync("biome.json", `${JSON.stringify(b, null, "\t")}\n`);'
cat > vite.config.ts <<'EOF'
import { defineConfig } from "vite";

// Builds src/server.ts into build/server/index.js, one file per source file so import.meta.main
// stays true only there. Every library stays in node_modules so OpenTelemetry can patch it.
export default defineConfig({
	build: {
		outDir: "build/server",
		rollupOptions: {
			output: {
				entryFileNames: (chunk) => (chunk.isEntry ? "index.js" : "[name].js"),
				preserveModules: true,
				preserveModulesRoot: "src",
			},
		},
		ssr: "src/server.ts",
	},
	ssr: { external: true },
});
EOF
cat >> src/server.ts <<'EOF'

// Node runs this file in development and its build in production; tests only import it.
if (import.meta.main) {
	serverServe(serve({ fetch: app.fetch, port: ENV.PORT }, serverListening) as Server);
}
EOF
perl -0pi -e 's/^import /import { serve } from "\@hono\/node-server";\nimport /m' src/server.ts
npm pkg set scripts.build="vite build" scripts.check="varlock codegen && biome check . && tsc --noEmit"
perl -pi -e 's{node --import \./src/preload\.ts --conditions=development \./node_modules/\@react-router/dev/bin\.cjs dev}{node --watch --import ./src/preload.ts src/server.ts}' package.json
pnpm remove @react-router/dev @react-router/node @tailwindcss/vite @types/react @types/react-dom class-variance-authority cn radix-ui react react-dom react-router react-router-hono-server shadcn tailwindcss
npm pkg delete "imports[#ui/*]"
pnpm add @hono/node-server@^2.1.5
pnpm exec biome lint --write --unsafe --only=correctness/noUnusedImports .
pnpm exec biome check --write .
```

Add the UI pages back: `git revert` the "Remove ui" commit. For each Domain created after it, copy the `*-list.tsx` and `*-detail.tsx` pages and their tests from `apps/app/src/ui/routes/` of the Template release named in `.template.json`, renamed to the Domain, and add their lines at the `domain-create:` markers in `src/ui/routes.ts` and `src/ui/context.ts` and the `context` marker in `src/server.ts`.

## Live updates

The live update streams (`/live/<domain>/<id>`, `@n8io/baseline-live`) and each Domain's live updates port. Redis stays for the cache; once both are gone, [Redis](#redis) can go too.

```sh
find src \( -name '*-live.ts' -o -name '*-live.test.ts' \) -delete
perl -0pi -e 's{^[ \t]*(//|#) piece-start: live\n.*?^[ \t]*(//|#) piece-end: live\n}{}gms' $(git grep -l 'piece-start: live' -- ':!*.md')
pnpm remove @n8io/baseline-live
pnpm exec biome lint --write --unsafe --only=correctness/noUnusedImports .
pnpm exec biome check --write .
```

Add live updates back: `git revert` the "Remove live" commit. For each Domain created after it, copy every `piece-start: live` block and the `api/*-live.ts` file and its test from the Domain in `apps/app/src/domains/` of the Template release named in `.template.json`, renamed to the Domain, and add its route at the `live` marker in `src/server.ts`.

## The cache

Each Domain's cache port and its adapters (`spi/<domain>-cache.*.ts`, `spi/<domain>-cached.ts`), the read-through in its get Use case and the clears in its update and delete Use cases. Every get then reads the database. Live updates and Redis stay.

```sh
find src \( -name '*-cache.*.ts' -o -name '*-cached.ts' \) -delete
perl -0pi -e 's{^[ \t]*(//|#) piece-start: cache\n.*?^[ \t]*(//|#) piece-end: cache\n}{}gms' $(git grep -l 'piece-start: cache' -- ':!*.md') </dev/null
pnpm remove @n8io/baseline-cache
pnpm exec biome lint --write --unsafe --only=correctness/noUnusedImports .
pnpm exec biome check --write .
```

A Project with no Domain yet has no cache blocks, so the second line reads `/dev/null` instead of waiting for input.

Add the cache back: `git revert` the "Remove cache" commit. For each Domain created after it, copy every `piece-start: cache` block and the `spi/*-cache.*.ts` and `spi/*-cached.ts` files from the Domain in `apps/app/src/domains/` of the Template release named in `.template.json`, renamed to the Domain, and put `cache: redisClient` back in the `ports` of `src/server.ts`, `src/worker.ts` and `src/seed.ts`.

## Redis

The Redis connection (`src/redis.ts`), `CACHE_URL` and the Redis container. The cache and live updates both run on it, so remove them first; the first line stops while either is installed.

```sh
if grep -qE '"@n8io/baseline-(cache|live)"' package.json; then echo "Remove the cache and live updates first: both run on Redis." >&2; exit 1; fi
rm src/redis.ts src/redis.redis.test.ts
perl -0pi -e 's{^[ \t]*(//|#) piece-start: redis\n.*?^[ \t]*(//|#) piece-end: redis\n}{}gms' $(git grep -l 'piece-start: redis' -- ':!*.md')
perl -0pi -e 's/^(#.*\n)*CACHE_URL=.*\n//m' .env.schema .env.development .env.production .env.test
pnpm remove redis
pnpm exec biome lint --write --unsafe --only=correctness/noUnusedImports .
pnpm exec biome check --write .
```

Add Redis back: `git revert` the "Remove redis" commit, before you add back the cache or live updates.

## The queue and the Worker

The queue (`@n8io/baseline-queue` on pg-boss), each Domain's Events and its Schedules, and the Worker (`src/worker.ts`, its compose service and its image entry). Each Domain's transaction becomes a plain Postgres transaction, and its Use cases stop publishing. The API, sign-in, the pages, live updates, the cache and Bridges stay; a Bridge is a read port and runs in the server. A Project with Consumers removes them first; the first line stops while any is left.

```sh
if git grep -q queueConsumerCreate -- src ':!*.test.ts'; then echo "Remove your Consumers first: they run only in the Worker." >&2; exit 1; fi
rm src/worker.ts test/integration/worker-shutdown.test.ts
find src \( -path '*/api/*-schedule.ts' -o -path '*/api/*-schedule.test.ts' -o -path '*/spi/*-transaction.postgres.test.ts' \) -delete
perl -0pi -e 's{^[ \t]*(//|#) piece-start: queue\n.*?^[ \t]*(//|#) piece-end: queue\n}{}gms' $(git grep -l 'piece-start: queue' -- ':!*.md') </dev/null
perl -0pi -e 's/^# schedule overrides.*\n((# @.*\n)?SCHEDULE_.*\n|# domain-create: schedules\n)*//m' .env.schema
perl -pi -e 's{\(HEALTH_PORT=9001 node --watch --import \./src/preload\.ts src/worker\.ts & ([^)]*)\)}{$1}' package.json
pnpm remove @n8io/baseline-queue
pnpm exec biome lint --write --unsafe --only=correctness/noUnusedImports .
pnpm exec biome check --write .
```

The fifth line drops the `SCHEDULE_*` overrides from `.env.schema`, and the sixth takes the Worker out of `pnpm dev`. `pnpm check` then regenerates `src/env.d.ts`.

Add the queue and the Worker back: `git revert` the "Remove queue" commit. For each Domain created after it, copy every `piece-start: queue` block and the `api/*-schedule.ts`, `api/*-schedule.test.ts` and `spi/*-transaction.postgres.test.ts` files from the Domain in `apps/app/src/domains/` of the Template release named in `.template.json`, renamed to the Domain, and add its schedule at the `schedules` marker in `src/worker.ts` and its `SCHEDULE_*` line at the one in `.env.schema`.

To run Events on Apache Pulsar instead of the queue, follow the [Pulsar swap guide](https://github.com/n8io/baseline/blob/main/packages/pulsar/README.md).
