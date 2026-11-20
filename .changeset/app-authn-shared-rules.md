---
"app": major
---

The Template moves to the new `@n8io/baseline-authn` major: `src/ui/context.ts`, `src/ui/root.tsx` and `src/ui/routes/router-test-context.ts` use `authnExpiresAtContext`, and every `authnMemoryTokenFetch` and `authnTestSignIn` call passes `baseUrl` (`scripts/api-smoke.ts`, `test/integration/*`). `docs/agents/authn.md` opens the app at the URL `pnpm dev` prints instead of `localhost:3000`.

To upgrade a Project: run `pnpm template-upgrade`. Then, in your own code, rename `authnExpiryContext` to `authnExpiresAtContext`; pass `baseUrl` instead of `url` to `authnMemoryTokenFetch`, `authnMemoryAuthorizationCreate` and `authnTestSignIn`; pass `renewMs` (milliseconds) instead of `renewSeconds`; read `AuthnMemoryToken.expiresAt` as epoch ms; and import `authnTestTokenCreate` from `@n8io/baseline-authn/testing` where a test called `authnMemoryTokenCreate`.
