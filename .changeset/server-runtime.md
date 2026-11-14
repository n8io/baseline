---
"app": major
---

The Server reports alive only after its Postgres check, drains on its own variable, and development has a user per role and a machine client.

- `src/server.ts` calls `connectionsOpen` before it opens the health port, as the Worker does, so `/livez` never answers for a Server that cannot reach Postgres (a startup probe on `/livez` now proves the check passed).
- `SHUTDOWN_DRAIN_DELAY_MS` (new, optional) sets how long the Server keeps serving after SIGTERM; unset means 5000. `.env.development` and `.env.test` set it to 0. The drain no longer depends on `APP_ENV`, so a prod-like run under `APP_ENV=test` can have the production drain.
- `src/authn.ts` exports `authnMemoryUsersCreate(scopes)` (Dev user without scopes, Dev admin with all) and `authnMemoryClientsCreate(scopes)` (`dev-client`, for `authnMemoryTokenFetch`). `src/server.ts` builds one `scopes` list and passes it to both.
- `connectionsOpen({ role, urls })` takes optional `urls: { cache, database }`, so a test can open a real database with the cache in memory. `databaseOpen` takes `{ role, url }`.
- New `docs/agents/authn.md` (roles, scopes, machine clients, dev users); `deploy-kubernetes.md` gains PgBouncer settings, the load balancer check, the memory issuer on a scaled stack and the drain variable.

To upgrade a Project: in `src/server.ts` move `const connections = await connectionsOpen(...)` above `healthServerCreate`; replace `drainDelayMs: envLocal ? 0 : 5_000` with `ENV.SHUTDOWN_DRAIN_DELAY_MS ?? 5_000`; replace the inline `memoryUsers` with a `const scopes: string[] = [...<domain>Scopes, // domain-create: scopes]` list and `memoryClients: authnMemoryClientsCreate(scopes)`, `memoryUsers: authnMemoryUsersCreate(scopes)`, copying the two functions from the Template's `src/authn.ts` (add one dev user per role there). Add `SHUTDOWN_DRAIN_DELAY_MS` to `.env.schema` (the Template's lines) and `SHUTDOWN_DRAIN_DELAY_MS=0` to `.env.development` and `.env.test`. In `src/connections.ts` take `urls` and change `databaseOpen` as the Template does; a test that opened `databaseOpen(role)` passes `{ role, url }`. Copy `docs/agents/authn.md` and its "Read when" line.
