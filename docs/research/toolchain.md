# Toolchain versions and choices

Research for [#7](https://github.com/n8io/baseline/issues/7). Date of research: 2026-10-31. Versions and dates come from the npm registry and the Node.js release schedule unless noted. Items marked "tested" were run in a scratch project on this date.

## Summary

| Question | Answer |
| --- | --- |
| Node | Node 26 ("Lithium") became LTS on 2026-10-28, supported to 2029-04-30. Node 24 is now in Maintenance (since 2026-10-20), to 2028-04-30. |
| TypeScript | 7.0.2 is `latest` and is the native (Go) compiler under the normal `typescript` package. It has no JS API yet; 7.1 (beta) is expected to add one. |
| Build tool | tsdown 0.23.4. tsup is unmaintained and points to tsdown. tsdown is still 0.x. |
| Zod | 4.6.7. Zod 4 is the current major. |
| Hono OpenAPI | `@hono/zod-openapi` 1.6.3 (Zod 4, Hono's own docs recommend it). `hono-openapi` 1.5.0 is the alternative if schema-library independence matters. |
| Biome vs dependency-cruiser | Biome 2.6.4 can enforce simple folder rules, but not resolved-path rules. Keep dependency-cruiser, but it does not support TypeScript 7 yet (tested), so it needs a TS 6 alias. |

## Node

- Release schedule (Node.js Release working group, `schedule.json`):
  - v22: LTS 2024-10-29, Maintenance 2025-10-21, end of life 2027-04-30.
  - v24: LTS 2025-10-28, Maintenance 2026-10-20, end of life 2028-04-30.
  - v26: released 2026-05-05, LTS 2026-10-28, Maintenance 2027-10-20, end of life 2029-04-30.
  - v23 and v25 are odd-numbered and already ended.
- Latest LTS releases on 2026-10-31: v26.13.0 (2026-10-28), v24.22.2 (2026-10-27) (nodejs.org/dist/index.json).
- Docker official images `node:26-slim` and `node:24-slim` both exist.
- Ecosystem floors: tsdown requires `^22.18.0 || ^24.11.0 || >=26.0.0`; dependency-cruiser requires `^22 || ^24 || >=26`; `@opentelemetry/sdk-node` requires `>=22.15.0`. All accept 24 and 26.
- Choice for the spec: pin Node 26 for the Dockerfile and `.node-version`, since it is the only active LTS line with the longest runway. Set `engines.node` to `>=24` so consumers on 24 still work, and run CI on 24 and 26. Caveat: 26 went LTS three days before this research, so ecosystem packages have had little time on it; 24 is the conservative fallback.

## TypeScript

- TypeScript 7.0 shipped 2026-07-08 as "a 10x faster native port of TypeScript" written in Go (TypeScript blog, "Announcing TypeScript 7.0"). Current `latest` is 7.0.2; `beta` is 7.1.0-beta; `next` is nightly 7.1.0-dev.
- It installs as `npm install -D typescript` and provides the new `tsc`. The old `@typescript/native-preview` package is stale (last publish 2026-07-07); nightlies now go under `typescript@next`. The `microsoft/typescript-go` repo is a staging repo.
- No API: "While TypeScript 7.0 is here, it does not ship with an API. We expect TypeScript 7.1 to ship with a new (and different) API." Tools that call the TS compiler API cannot use 7.0.
- Compatibility package: `@typescript/typescript6` (6.0.2) provides a `tsc6` bin and the 6.0 API. The blog says to use npm aliases to run 6 and 7 side by side.
- Breaking defaults: `strict` is true, `module` defaults to `esnext`, `rootDir` defaults to `./`, `types` defaults to `[]`. 6.0 deprecations are now errors (`baseUrl`, `moduleResolution: node`/`node10`/`classic`, `target: es5`, AMD/UMD/SystemJS).
- Tooling not ready: `typescript-eslint` 8.72.1 peers `typescript <6.1.0`. Not relevant if Biome is the only linter, which matches the settled stack.
- Choice for the spec: TypeScript 7.0.x as the compiler for typechecking (`tsc --noEmit`). Add a TS 6 alias only for tools that need the API (see dependency-cruiser below).

## Build tool for publishable ESM packages

- tsup's README now says: "This project is not actively maintained anymore. Please consider using tsdown instead." Latest on npm is 9.0.0.
- tsdown 0.23.4 (2026-10-29) is built on Rolldown and is an official Rolldown project. It is still 0.x; the docs do not claim 1.0. The migration guide shows breaking changes between 0.22 and 0.23 (removed tsup-style options), so expect minor-version breakage and pin exact versions.
- Declarations: tsdown uses `rolldown-plugin-dts`. With `isolatedDeclarations` enabled in `tsconfig.json`, it generates `.d.ts` with oxc and does not touch the TypeScript compiler. Without it, it falls back to the TypeScript compiler, which is the risky path on TS 7 (no API). `rolldown-plugin-dts` 0.28.8 lists `typescript: ^5 || ^6 || ~7.0.0` as a peer, and tsdown lists `^5 || ^6 || ^7`, so installs resolve, but I did not test a full build with TS 7.
- Choice for the spec: tsdown, with `isolatedDeclarations: true`, ESM only, `publint` and attw validation (both are optional tsdown peers). Plain `tsc` stays as the typecheck step only. Packages that only ship source in the workspace (no publish) do not need a build.

## Zod and the Hono OpenAPI integration

- Zod 4 is the current major (zod.dev/v4: "Zod 4 is now stable"). `latest` is 4.6.7 (2026-10-12). Zod 4 has first-party `z.toJSONSchema()` and a metadata registry (`.meta()`).
- `@hono/zod-openapi` 1.6.3 (honojs/middleware): peers `zod ^4.0.0` and `hono >=4.10.0`. Hono's own docs ("Zod OpenAPI" example) present it as the way to do OpenAPI. It uses `OpenAPIHono`, `createRoute` and `app.openapi(route, handler)`; `app.doc31()` serves OpenAPI 3.1. It builds on `@asteasolutions/zod-to-openapi` 9.x. Limits from its README: mixing plain `Hono` sub-apps loses route definitions, and request bodies are validated only for JSON and form types.
- `hono-openapi` 1.5.0 (rhinobase, 2026-10-18): peers only `hono ^4.11.2`; works with any Standard Schema library through `@standard-community/*`, so Zod is not hard-wired. README says "still in development".
- Hono: `latest` is 4.13.14; a `5.0.0-rc.1` exists under the `next` tag. Stay on 4.x for the template.
- Choice for the spec: `@hono/zod-openapi`. It matches "Zod is the one schema library" and is the integration Hono documents. Consider `hono-openapi` only if the stack ever needs a second schema library.

## Biome versus dependency-cruiser for layer boundaries

- Biome 2.6.4 (2026-10-28; 2.6.0 on 2026-10-21).
- `noRestrictedImports` (style group, off by default) has `paths` and, since 2.2.0, gitignore-style `patterns` with a message. Tested: with an `overrides` block scoped to `src/domains/**`, patterns `**/spi/**` and `../*/**` correctly flagged a domain importing the SPI and a domain importing another domain.
- Limits found in that test: it matches the import specifier text, not the resolved file. Imports through a path alias or a workspace package name (for example `@n8io/database`) are matched only by that name, so one rule per forbidden specifier is needed. "Domain A may not import domain B" has no equivalent of a back reference, so each domain would need its own override listing every other domain. The biomejs.dev page for the rule does not describe directory-based use; the above is from the test, not the docs.
- `noPrivateImports` (correctness group, since 2.0.0) works from `@public`/`@package`/`@private` JSDoc tags and folder visibility. It does not do layer rules and skips dynamic `import()`.
- dependency-cruiser 18.7.0 (2026-10-19; needs Node `^22 || ^24 || >=26`) validates the resolved dependency graph with `from`/`to` path regexes, and regex capture groups (`$1`) work, so "no cross-domain imports" is one rule (tested). It also covers circular dependencies and orphans.
- Surprise, tested: dependency-cruiser 18.7.0 does not support TypeScript 7. With `typescript@7.0.2` installed it cruised 0 modules and printed: "missing-tsc-transpiler: ... not a compatible TypeScript compiler (typescript: >=2.0.0 <7.0.0) ... Support for typescript@>=7 will follow when its API is published and stable." With `typescript` aliased to `@typescript/typescript6` and `typescript7` aliased to `typescript@7.0.2`, it found both violations (domain to SPI, user to order) and `tsc` still reported 7.0.2. The alias approach works but needs a decision on how the repo wires it.
- Answer: Biome's import rules do not make dependency-cruiser unnecessary. They cover simple cases and give fast editor feedback; dependency-cruiser is needed for resolved paths, alias imports and the per-domain rule. Keep both, with Biome as the cheap first check.

## Version list for the spec

| Tool | Version (2026-10-31) |
| --- | --- |
| Node | 26.13 (LTS), floor `>=24` |
| TypeScript | 7.0.2 (plus `@typescript/typescript6` 6.0.2 alias for dependency-cruiser) |
| tsdown | 0.23.4 (pin exact) |
| Zod | 4.6.7 |
| Hono | 4.13.14 |
| `@hono/zod-openapi` | 1.6.3 |
| Biome | 2.6.4 |
| dependency-cruiser | 18.7.0 |
| Vitest | 5.0.5 (latest) |
| pnpm | 12.16.1 |

## Sources

- Node.js release schedule: https://github.com/nodejs/Release/blob/main/schedule.json ; https://nodejs.org/dist/index.json
- TypeScript 7.0 announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- typescript-go: https://github.com/microsoft/typescript-go
- tsdown: https://tsdown.dev/guide/ , https://tsdown.dev/options/dts , https://tsdown.dev/guide/migrate-from-tsup ; tsup README on npm
- Zod 4: https://zod.dev/v4
- Hono OpenAPI: https://hono.dev/examples/zod-openapi ; https://github.com/honojs/middleware/tree/main/packages/zod-openapi ; https://github.com/rhinobase/hono-openapi
- Biome: https://biomejs.dev/linter/rules/no-restricted-imports/ ; https://biomejs.dev/linter/rules/no-private-imports/
- dependency-cruiser: https://github.com/sverweij/dependency-cruiser
- Versions, dates, engines and peer dependencies: `npm view <pkg> ...` on 2026-10-31
