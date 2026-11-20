---
"@n8io/baseline-authn": major
---

authn follows the shared Package rules. Breaking:

- `authnMemoryTokenCreate` leaves the main entry: import `authnTestTokenCreate` from `@n8io/baseline-authn/testing` instead (same `{ actor, authn }`), from test files only.
- `authnMemoryTokenFetch`, `authnMemoryAuthorizationCreate` and `authnTestSignIn` take the app's origin as `baseUrl` instead of `url`.
- `authnMemoryAuthorizationCreate` takes `renewMs` (milliseconds, default 60,000) instead of `renewSeconds`, and throws a `TypeError` instead of a `RangeError` for a bad value.
- `AuthnMemoryToken.expiresAt` is epoch ms (a number) like every other `expiresAt`, not a `Date`.
- `authnExpiryContext` from `@n8io/baseline-authn/react-router` is now `authnExpiresAtContext`.

Not breaking: `AuthnInvalidError` is exported; `authorizeParams`, `audienceClaim` and `memoryIssuerAllowed` accept `null` as unset; every export has a doc comment, the README and `authnRoutesCreate` say the routes must be mounted at `/auth`, and the two provider warnings carry a message.
