---
"app": minor
---

Seeds return the rows they ensured, and a script example shows the pattern.

- `fooSeed(u, actor)` creates each example by its name, reads the row that holds a name already taken, and returns all three foos. An empty, half-seeded or seeded database ends the same, so `pnpm seed` can run twice. A seed that needs another Domain's ids keeps the result: `const foos = await fooSeed(...)`, then pass it to the next seed.
- `pnpm api-smoke [--url <origin>] [--wait <seconds>]` (`scripts/api-smoke.ts`) gets the dev client's token, calls `/api/v1/openapi.json` and every GET route without a path parameter, prints one line per call and a summary, exits 1 on a failure and flushes telemetry last. `docs/agents/scripts.md` explains how to copy it for a Project's own script.

To take this: copy `src/domains/foo/api/foo-seed.ts` into your Domains' seeds by hand where a seed should return its rows, and take `scripts/api-smoke.ts`, its two tests, `docs/agents/scripts.md` and the `api-smoke` script line from the Template (`pnpm template-upgrade` brings them).
