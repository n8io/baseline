---
"app": major
---

The Template takes `@n8io/baseline-authn`'s React Router exports from its new `/react-router` subpath, and passes `memoryIssuerAllowed: envLocal` to `authnCreate`. When you upgrade, import `actorContext` and `authnExpiryContext` from `@n8io/baseline-authn/react-router`, replace `authnActorRequire(args)` in loaders and actions with `authnPageActorRequire(args)` from the same subpath, and add `memoryIssuerAllowed: envLocal` to your `authnCreate` call.
