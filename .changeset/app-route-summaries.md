---
"app": major
---

Every route sets a one-line `summary` ("Create one foo", "List foos, one page at a time"…). It is the generated CLI command's help and the generated SDK function's doc comment, and `aggregate-create` writes one for each route it adds. `test/integration/server-wiring.test.ts` now fails on an operation without a summary.

To upgrade a Project: after `pnpm template-upgrade`, add a one-line `summary` to each of your routes' `createRoute` calls (`pnpm test:integration` names any you missed). If the Project keeps `clients/sdk`, run the `sdk-generate` script and commit `clients/sdk`.
