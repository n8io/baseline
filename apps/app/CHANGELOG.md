# app

## 1.2.0

### Minor Changes

- 0476761: Projects keep their dependencies up to date by themselves: Dependabot waits 7 days before offering a release (baseline packages excepted), groups patch and minor updates, and a new `automerge` CI job merges every update PR that is not a major once CI passes.

### Patch Changes

- f6ad1f1: Add `postgresPortsGuard` and `postgresCursorEncode`/`postgresCursorDecode` (generic over the id prefix). The Foo SPI imports them instead of keeping its own `foo-ports-guard.ts` and `foo-cursor.ts`, so a new Domain no longer copies them.
- f9e3433: New package `@n8io/baseline-pulsar`: Events and Consumers on Apache Pulsar 5, sent after the transaction commits, with the queue package's inbox for duplicates. Schedules stay on pg-boss. The queue package now exports `queueJobRun` and `queueRetryLimit`, which the pulsar package shares. The glossary's Event is now delivered once the change that caused it commits.
- cbd9f72: `queueStop` is gone: call `queue.stop()`. `schedulesRegister` takes the composition root's `ENV` (any object; an item that is not a string is no override), so the Worker no longer reads `process.env`. The shutdown package no longer exports the `ShutdownOptions` type; server.ts and worker.ts use `ShutdownHandle`. The postgres and queue tests share one Postgres test setup in `test/postgres/`.
- 80a93f3: Add a Spans section to AGENTS.md: when to set an attribute on the active span, when a Use case may start a child span, and when never to.
- 013aa86: Fix the "Where new work goes" table and the `pnpm dev` description in AGENTS.md, import `cn` through `#ui/lib/utils.ts`, split the integration test helpers, and tidy app-ci.yml: drop the redundant integration `env:` block and the image job's Dockerfile test step, and give every job a timeout.
- 9344425: The render and domain-create now work from `// domain-create: domains-start` / `domains-end` marker pairs in `server.ts`, `worker.ts`, `seed.ts`, `ui/context.ts` and `ui/routes.ts` instead of copies of those files' text, so editing those files outside the pairs no longer breaks the render. `.template.json` no longer gets a `repository` field.
- b99f091: Trim exports nobody imports and the dependencies nobody uses.
  - logger: the root no longer exports `LoggerErr`, `loggerErrSerialize`, `loggerRedactPaths` or `LoggerFields`. Import `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
  - authn: the root no longer exports `AuthnInvalidError`.
  - live: the root no longer exports the `LiveUpdate` type. `liveRedis` now takes the `RedisClient` type and time limit from `@n8io/baseline-cache`.
  - cache: `cacheRedisClientCreate` takes only `{ cacheUrl }`, and the root exports `cacheTimeLimit`.
  - postgres: drops its unused `zod` peer dependency.
  - app: drops the unused `lucide-react` dependency.
- Updated dependencies [f6ad1f1]
- Updated dependencies [f9e3433]
- Updated dependencies [cbd9f72]
- Updated dependencies [b99f091]
  - @n8io/baseline-postgres@1.1.0
  - @n8io/baseline-queue@2.0.0
  - @n8io/baseline-shutdown@2.0.0
  - @n8io/baseline-authn@2.0.0
  - @n8io/baseline-cache@2.0.0
  - @n8io/baseline-live@2.0.0
  - @n8io/baseline-logger@2.0.0
  - @n8io/baseline-http@1.1.1
  - @n8io/baseline-telemetry@1.1.1

## 1.1.0

### Minor Changes

- 75e4ae8: Projects install the baseline packages with the built-in GITHUB_TOKEN instead of a personal access token: the template CI grants `packages: read` and Dependabot needs no registry block.

## 1.0.3

### Patch Changes

- 859aff4: A cold `pnpm dev` no longer reloads mid-load with a failed `entry.client.tsx` import: `vite.config.ts` pre-bundles `class-variance-authority`, `cn` and `radix-ui`. The template now has a `public/` folder for static files, so the dev server no longer logs that `./public` is missing.

## 1.0.2

### Patch Changes

- 20dbeb1: Mutation testing is gone: no `pnpm test:mutation`, Stryker or `stryker.config.json`, and `app-ci.yml` has no `mutation` job (drop `ci / mutation` from your ruleset's required checks). `domain-create` now also copies foo's page tests (`test/unit/foo-{list,detail}.test.ts`, renamed) and, with a project's first domain, the home redirect test as `test/unit/home.test.ts`.

## 1.0.1

### Patch Changes

- 83f9868: Projects run CI through `app-ci.yml@v1`: the app ships `.github/workflows/ci.yml`, `.github/dependabot.yml`, a `test:mutation` script (Stryker on changed files) and a `ci` script.

## 1.0.0

### Major Changes

- 418010e: First release of the app template.
