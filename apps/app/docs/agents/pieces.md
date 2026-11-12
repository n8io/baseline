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
npm pkg set scripts.build="vite build" scripts.check="varlock codegen && biome check . && tsc --noEmit" scripts.dev="docker compose up -d --wait && node --import ./src/preload.ts src/migrate.ts && node --import ./src/preload.ts src/seed.ts && (HEALTH_PORT=9001 node --watch --import ./src/preload.ts src/worker.ts & node --watch --import ./src/preload.ts src/server.ts)"
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

## The queue and the Worker: not removable yet

Each Domain's transaction publishes its Events through the queue in the same Postgres transaction, and Consumers, Schedules and Bridges run only in the Worker. A Domain without Events needs a transaction with no outbox first: [#218](https://github.com/n8io/baseline/issues/218).

To run Events on Apache Pulsar instead of the queue, follow the [Pulsar swap guide](https://github.com/n8io/baseline/blob/main/packages/pulsar/README.md).
