# @n8io/baseline-live

## 4.0.0

### Major Changes

- dc8c9de: live no longer depends on `@n8io/baseline-cache`, so a project can install live without cache. `liveHubRedisCreate` takes any connected node-redis client, including the one `cacheRedisClientCreate` returns, and owns its own timeout. cache no longer exports `cacheTimeLimit`; copy the few lines into your code if you used it.

### Minor Changes

- f86d684: `react` and `react-router` are now optional peers, needed only for `@n8io/baseline-live/client`, so a service that only sends or streams live updates can install live without React. `useLiveUpdates` takes an optional `{ pathPrefix }` (default `/live`) for a Project that mounts the streams elsewhere.

## 3.0.0

### Major Changes

- 2685036: The live hub factories follow the entity-first, verb-last naming: `liveMemory` is now `liveHubMemoryCreate` and `liveRedis` is now `liveHubRedisCreate`. There are no deprecated aliases; rename the imports in your composition roots and tests.

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- Updated dependencies [5467b94]
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-cache@3.0.0
  - @n8io/baseline-logger@2.1.0

## 2.0.0

### Major Changes

- b99f091: Trim exports nobody imports and the dependencies nobody uses.
  - logger: the root no longer exports `LoggerErr`, `loggerErrSerialize`, `loggerRedactPaths` or `LoggerFields`. Import `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
  - authn: the root no longer exports `AuthnInvalidError`.
  - live: the root no longer exports the `LiveUpdate` type. `liveRedis` now takes the `RedisClient` type and time limit from `@n8io/baseline-cache`.
  - cache: `cacheRedisClientCreate` takes only `{ cacheUrl }`, and the root exports `cacheTimeLimit`.
  - postgres: drops its unused `zod` peer dependency.
  - app: drops the unused `lucide-react` dependency.

### Patch Changes

- Updated dependencies [b99f091]
  - @n8io/baseline-cache@2.0.0
  - @n8io/baseline-logger@2.0.0

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-logger@1.0.0
