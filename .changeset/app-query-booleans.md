---
"app": minor
---

Boolean query parameters (`count`, `archived`) are documented as `type: boolean` with `default: false`, not as a string, so the generated SDK takes `fooList({ count: true })` and the CLI offers `--count` / `--no-count`. The server still accepts only `true` or `false`, so no request changes. `pnpm api-check` reads an older base document's string-typed booleans as booleans, so the change is not reported as breaking.

To upgrade a Project: after `pnpm template-upgrade`, add `.openapi({ default: false, type: "boolean" })` after `.default(false)` on each of your routes' `z.stringbool(...)` query parameters. If the Project keeps `clients/sdk`, run the `sdk-generate` script and commit `clients/sdk`.
