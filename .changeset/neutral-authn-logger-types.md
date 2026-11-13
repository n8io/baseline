---
"@n8io/baseline-authn": major
"@n8io/baseline-logger": major
---

Public types no longer carry vendor types. `Authn` is opaque (its fields were internal), and `actorFromClaims` takes `AuthnClaims`, a plain `Record<string, unknown>`, in place of jose's `JWTPayload`. `logger` is typed as the package's own `Logger` (the level methods and `level`), not pino's.
