---
"@n8io/baseline-authn": major
"@n8io/baseline-logger": major
---

Public types no longer carry vendor types. `Authn` is opaque (its fields were internal), and `actorFromClaims` takes `AuthnClaims`, a plain `Record<string, unknown>`, in place of jose's `JWTPayload`. `logger` is typed as the package's own `Logger` (the level methods and `level`), not pino's: a call is `(fields, message?)` or `(message)`, with no `child`, no printf-style arguments and a read-only `level`. Only an `Authn` from `authnCreate` is accepted; a hand-built or cloned one throws.
