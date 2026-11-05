# app

## 2.0.1

### Patch Changes

- ecc4ac7: An `/api/v1` request without a signed-in Actor now answers 401 before any route validates its input, so an anonymous caller no longer learns the API's input shape from 400 errors. `/api/v1/openapi.json` stays public.
- da55733: `glossary-check` takes the glossary and the tree to scan (`pnpm glossary-check [glossary] [tree]`, defaults `CONTEXT.md` and `.`), and no longer flags an alias inside a path or script name such as `test/integration` or `test:integration`.
- 11e525b: Move `autoInstallPeers: false` from `.npmrc`, which pnpm 12 ignores for non-auth settings, to `pnpm-workspace.yaml`, and delete `.npmrc`. Projects that upgrade lose `.npmrc` and the Dockerfile stops copying it; keep only auth and registry lines in any `.npmrc` you add.
- b0fb22e: `docs/agents/template-upgrade.md` and `docs/agents/dependency-updates.md` walk a person through a Template upgrade and through dependency updates one step at a time. Ask your agent: "Walk me through a template upgrade with docs/agents/template-upgrade.md."

## 2.0.0

### Major Changes

- ecc00e0: The template's CI calls `app-ci.yml@v2`, which needs no token: the `PACKAGES_TOKEN` secret, the GitHub Packages registry setup and every `NODE_AUTH_TOKEN` are gone, and the caller drops `packages: read` and `secrets: inherit`. Every action is pinned to a commit SHA, and Dependabot keeps those pins current. Projects move to `app-ci.yml@v2` and `dependabot-automerge.yml@v2`; `v1` stays frozen where it is.

### Minor Changes

- ca7afb0: `httpSecureHeaders` applies Hono's secure headers (HSTS, nosniff, Referrer-Policy and the rest) with an enforced Content-Security-Policy: `default-src 'self'`, `script-src 'self'` plus a per-request nonce, `object-src 'none'`, `base-uri 'self'` and `frame-ancestors 'none'`. The app uses it on every response and hands the nonce to React Router's server render, so every inline script carries it, in development too. Request bodies on `/api/*` are capped at 1 MB and a bigger one answers 413 `PayloadTooLarge`. The memory issuer's sign-in pages drop their inline styles, which the CSP blocks. Rate limiting stays at the load balancer or edge.
- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- db838cc: Template docs: `AGENTS.md` keeps only the rules every task needs and ends with a `## Read when` index. Events, Bridges and Aggregates, Data rules, Tracing and spans, and Runtime notes move to `docs/agents/`, read only when the task needs them. `structure.test.ts` keeps `AGENTS.md` under 200 lines and checks that every linked doc exists and every doc is linked.
- 5467b94: Factories that build and return a thing now end in `Create`: `cacheMemory` is `cacheMemoryCreate`, `cacheRedis` is `cacheRedisCreate`, `queueEventsMemory` is `queueEventsMemoryCreate`, `queueEventsPgBoss` is `queueEventsPgBossCreate` and `pulsarEvents` is `pulsarEventsCreate`. There are no deprecated aliases; rename the imports.
- 2685036: The live hub factories follow the entity-first, verb-last naming: `liveMemory` is now `liveHubMemoryCreate` and `liveRedis` is now `liveHubRedisCreate`. There are no deprecated aliases; rename the imports in your composition roots and tests.
- a37704e: `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440`, so pnpm refuses any release younger than a day. `@n8io/baseline-*` packages are exempt.

  If `pnpm install` then reports a duplicate `minimumReleaseAgeExclude` key, delete the older list of exact versions that pnpm wrote on its own.
- 4d37e1c: Template naming: AGENTS.md spells out the generic-to-specific rule (scope, subject, then action; factories end in `Create`, predicates in `Is`), and architecture rule A23 fails an exported name that starts with a verb. The integration helpers become `integrationSignIn` (in `integration-sign-in.ts`), `productionServerWaitFor` and `productionServerConnectResult`, and `loadContextCreate` becomes `uiLoadContextCreate`.
- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- b73602b: Telemetry now builds the metric reader itself, like the span and log processors: `OTEL_METRICS_EXPORTER` (`otlp` by default, `console` or `none`) and `OTEL_METRIC_EXPORT_INTERVAL` choose a periodic reader. Every signal exports OTLP over http/protobuf only; the grpc and http/json exporters are gone, and an `OTEL_EXPORTER_OTLP_*PROTOCOL` set to anything else prints one warning at start. The app's integration tests read OTLP protobuf and prove the use case duration metric reaches a collector.
- 2623e1e: The Node preloads live in one file, `src/preload.ts`: it loads varlock, registers the OpenTelemetry ESM loader hook and starts telemetry, in that order. Scripts run `node --import ./src/preload.ts <entry>`, and the image sets `NODE_OPTIONS="--import /app/src/preload.ts"` once, so its CMD and the compose worker are plain `node <entry>`. A runner that passes its own command should drop the flags and run `node src/worker.ts` or `node src/migrate.ts`. `dockerfile.test.ts` checks the one `NODE_OPTIONS` line and fails if the telemetry or loader-hook preload is named anywhere but `src/preload.ts`.
- bbb9fd5: `app-ci.yml@v2` adds a required `sast` job: Semgrep CE (pinned image, metrics off) with the `p/typescript`, `p/nodejs`, `p/react` and `p/secrets` rulesets, failing on any finding. app-create requires `ci / sast`. A suppression is `// nosemgrep: <rule-id> -- <reason>`, and `.semgrepignore` lists generated paths only.
- 3334669: Template docs: the Event entry says pg-boss carries Events by default and `@n8io/baseline-pulsar` is the one sanctioned swap, and Data rules say Drizzle stays on the pinned 1.0 rc until 1.0 GA.
- Updated dependencies [5467b94]
- Updated dependencies [ca7afb0]
- Updated dependencies [2685036]
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [b73602b]
- Updated dependencies [793ad13]
- Updated dependencies [acaff2a]
- Updated dependencies [33c61e9]
  - @n8io/baseline-cache@3.0.0
  - @n8io/baseline-queue@3.0.0
  - @n8io/baseline-http@1.2.0
  - @n8io/baseline-authn@2.1.0
  - @n8io/baseline-live@3.0.0
  - @n8io/baseline-health@1.1.0
  - @n8io/baseline-id@1.1.0
  - @n8io/baseline-logger@2.1.0
  - @n8io/baseline-postgres@1.2.0
  - @n8io/baseline-result@1.1.0
  - @n8io/baseline-shutdown@2.1.0
  - @n8io/baseline-telemetry@1.2.0

## 1.2.1

### Patch Changes

- f4f5c71: `pnpm build` always makes a production build. With `NODE_ENV=development` in the shell, `react-router build` made a development build that compiled out the server shutdown (`import.meta.env.PROD` was false), so SIGTERM killed the server at once.

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
