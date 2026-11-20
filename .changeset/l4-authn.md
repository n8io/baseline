---
"@n8io/baseline-authn": minor
---

authnCreate refuses an unknown `audienceClaim` and authnMiddlewareCreate an unknown `source` with a `TypeError` at the call (`authnCreate: audienceClaim must be "aud" or "client_id", found "x"`), where they used to fall back to `aud` and the cookie middleware. authnTestSignIn errors start `authnTestSignIn: `, and the `renewMs` message ends `found X`. The README Exports table is in entry order.
