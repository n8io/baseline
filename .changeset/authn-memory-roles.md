---
"@n8io/baseline-authn": major
"app": major
---

The memory issuer (`memory://`) now models your app's roles and machine clients, and its tokens work at every Server that shares `AUTHN_SECRET`.

- `memoryUsers: { id, name, scopes }[]` replaces `memoryAdminScopes`. The sign-in page offers one button per entry; without it, one `dev-user` without scopes.
- `memoryClients: { id, scopes }[]` and `POST /auth/token`, the client-credentials grant (memory issuer only; 404 with an OIDC provider). A requested `scope` must be a subset of the client's (else 400 `invalid_scope`).
- `authnMemoryTokenFetch({ url, clientId, scopes })` in the main entry fetches a machine token from a served app, for scripts and dev tools, so they no longer import `/testing`.
- The memory issuer signs HS256 with a key derived from `secret` instead of a fresh ES256 key per process, so a token signed at one pod verifies at the next. A refresh re-reads the user's `memoryUsers` entry, so a changed scope list takes effect at the next refresh and a removed user is signed out.
- `/testing`: `authnTestSignIn({ who })` takes a `memoryUsers` id (`"dev-admin"`, not `"admin"`), and the new `authnTestBearerCreate({ actorFromClaims })` gives a route test an `Authn` and `tokenFor(actor)`.

To upgrade a Project: in `src/server.ts` replace `memoryAdminScopes: [...]` with `memoryUsers: [{ id: "dev-user", name: "Dev user", scopes: [] }, { id: "dev-admin", name: "Dev admin", scopes: [...] }]`, keeping your scope list and the `// domain-create: scopes` marker inside the Dev admin's `scopes`, and add any role or machine client you need. In `src/authn.ts` omit `"memoryUsers"` instead of `"memoryAdminScopes"`. Every `who: "admin"` or `who: "user"` posted to `/auth/sign-in` or passed to `authnTestSignIn` becomes `"dev-admin"` or `"dev-user"`; `integrationSignIn(url, who)` keeps taking `"admin"` or `"user"`. A script that calls a running app lists its client in `memoryClients` and gets its token with `authnMemoryTokenFetch`.
