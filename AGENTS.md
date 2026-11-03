# Baseline

A template repo for new projects: shared `@n8io/baseline-*` packages and the `apps/app` template that new repos are generated from.

@apps/app/CONTEXT.md

## Verify

Run with Node 26 (`fnm use`) and pnpm from `packageManager`.

- setup: `pnpm install`
- format: `pnpm format`
- lint + typecheck (root files): `pnpm check`
- test (root files): `pnpm test`
- full CI-equivalent: `pnpm turbo run check test build`

Tests assert with `expect()` only: `expect.requireAssertions` does not count chai `assert` calls, so Biome bans importing `assert` from `vitest` and `chai`.
