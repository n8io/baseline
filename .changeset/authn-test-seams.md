---
"@n8io/baseline-authn": minor
---

Add optional `fetch` and `now` options to `authnMemoryTokenFetch` and `authnMemoryAuthorizationCreate`, a `fetch` option to `authnTestSignIn` and `AuthnOptions`, and `authnRefreshClientMiddlewareCreate`, so tests pass a fetch function or a clock instead of stubbing globals. Defaults are unchanged.
