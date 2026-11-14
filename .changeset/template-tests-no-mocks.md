---
"app": minor
---

The Template's tests use no mocks, spies or fake timers, so a Project copies none. The baseline repository's `test/no-mocks.test.ts` fails on any `vi.*` call (except `vi.waitFor` and `vi.waitUntil`) or `vi` import anywhere under `apps/app`. What changed: `src/server-wiring.test.ts`, `src/server-seed.test.ts` and `src/server-hmr.test.ts` are gone. The server wiring checks (`test/integration/server-wiring.test.ts`, now run by `pnpm test:integration`, which needs Docker and a build) and the Server's seeding check (`test/integration/foo-server-seed.test.ts`) now drive the production build over HTTP; the dev server's close order lives in `src/ui/server-dev-close.ts` with its own test; `error-tracking-open.test.ts` reports to a local Sentry-shaped server; `asset-reload-listen.test.ts` runs the function with plain-object stand-ins; `envMemoryRefused` (in `src/env.ts`) and `databaseOpen({ poolMax })` take their input instead of reading `ENV`; `templateUpgradeRun` takes an optional `output`.

To upgrade a Project: delete those three test files if the upgrade reports a conflict, and move any case you added to `src/server-wiring.test.ts` into `test/integration/server-wiring.test.ts`. Apply the `databaseOpen` and `envMemoryRefused` changes by hand if you changed those files.
