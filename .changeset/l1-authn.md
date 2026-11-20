---
"@n8io/baseline-authn": minor
---

Export the options types `AuthnMemoryAuthorizationOptions`, `AuthnMemoryTokenFetchOptions`, `AuthnMiddlewareOptions`, and from `/testing` `AuthnTestBearerOptions`, `AuthnTestSignInOptions`, `AuthnTestTokenOptions`. A handle that did not come from `authnCreate` now throws `<function>: authn must come from authnCreate`. Adds the `test:unit` script.
