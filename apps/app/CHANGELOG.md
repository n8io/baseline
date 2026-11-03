# app

## 1.0.2

### Patch Changes

- 20dbeb1: Mutation testing is gone: no `pnpm test:mutation`, Stryker or `stryker.config.json`, and `app-ci.yml` has no `mutation` job (drop `ci / mutation` from your ruleset's required checks). `domain-create` now also copies foo's page tests (`test/unit/foo-{list,detail}.test.ts`, renamed) and, with a project's first domain, the home redirect test as `test/unit/home.test.ts`.

## 1.0.1

### Patch Changes

- 83f9868: Projects run CI through `app-ci.yml@v1`: the app ships `.github/workflows/ci.yml`, `.github/dependabot.yml`, a `test:mutation` script (Stryker on changed files) and a `ci` script.

## 1.0.0

### Major Changes

- 418010e: First release of the app template.
