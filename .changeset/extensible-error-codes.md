---
"@n8io/baseline-http": major
"app": minor
---

Problem `code` is an extensible enum. `httpErrorResponsesCreate` now documents `code` as a string with `x-extensible-enum` listing its known values, so a route can answer a new error code on a status it already declares without oasdiff reporting `response-property-enum-value-added`. `types` also takes a `readonly` list (an `as const` array no longer fails with TS4104). The Template gains `pnpm api-check` (`scripts/api-check.ts`: oasdiff on `origin/main` against your working tree, the same command as CI's `oasdiff` job) and `docs/agents/api.md`, "Changing an API shape"; CI's `oasdiff` job now runs `pnpm api-check`.

To upgrade a Project: every response's `code` changes from `enum` to `x-extensible-enum`, which oasdiff 1.35.0 reports as `response-property-became-not-enum` (an error) once per error response. `pnpm api-check` and CI's `oasdiff` job read the `main` document with the old closed list as the open one, so the upgrade PR passes without an ignore file; nothing to do. Apply the Template's `scripts/api-check.ts`, the `api-check` script in `package.json` and `docs/agents/api.md` if `pnpm template-upgrade` conflicts on them. Foo's routes are unchanged.
