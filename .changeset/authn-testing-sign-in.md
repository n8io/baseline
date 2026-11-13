---
"@n8io/baseline-authn": major
"app": major
---

`@n8io/baseline-authn/testing` is new: `authnTestSignIn({ url, who, secret })` signs in at a served app through the memory issuer's form and returns `authorization`, `cookie`, `token` and `accessCookie`. It opens the access cookie with the package's own cookie code. Import it from test files only. The README has a Testing section.

`authnMemoryTokenCreate` takes one options object: `authnMemoryTokenCreate({ authn, actor })`. A call that passes `authn` and the Actor as two arguments no longer compiles.

In the Template, `test/integration/integration-sign-in.ts` calls `authnTestSignIn` and holds no cryptography of its own; `integrationSignIn(url, who)` and `SignedIn` are unchanged, so tests that call it do not change. `src/server-wiring.test.ts` passes `{ actor, authn }`. When you upgrade, take the new `integration-sign-in.ts` whole, and change every `authnMemoryTokenCreate(authn, actor)` in your own tests to `authnMemoryTokenCreate({ actor, authn })`.
