---
"app": minor
---

A Project can now remove the UI pages or live updates. `docs/agents/pieces.md` lists the exact steps for each, and CI runs them on a fresh render to prove an API-only Project still passes check, unit tests and build and serves its API. The code each piece owns sits in `// piece-start: <piece>` to `// piece-end: <piece>` blocks, `pnpm domain-create` leaves a removed piece out of new Domains, and `src/server.ts` now exports its Hono `app`. The cache and the queue are not removable yet (#217, #218).
