---
"@n8io/baseline-authn": major
---

The main entry no longer imports React Router, so an API or Worker can verify tokens without installing `react` or `react-router`, which are now optional peers.

- `actorContext` and `authnExpiryContext` move to the new `@n8io/baseline-authn/react-router` subpath.
- `authnActorRequire` takes only a Hono `Context`. For a loader or action, import `authnPageActorRequire(args)` from `@n8io/baseline-authn/react-router`; it throws the same redirect to sign-in.
- `authnCreate` refuses `issuerUrl: "memory://"` unless you pass `memoryIssuerAllowed: true`. Pass it only in development and test.
