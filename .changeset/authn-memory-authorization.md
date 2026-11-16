---
"@n8io/baseline-authn": minor
"app": patch
---

`authnMemoryAuthorizationCreate({ clientId, url })` returns a function that gives a script the current `Authorization` value of a memory machine client and fetches a new token before the held one expires (15 minutes), so a script that runs longer stops failing with 401s. Callers share one fetch; `{ renew: true }` refetches after a 401. `authnMemoryTokenFetch` stays for a script that ends sooner.

To upgrade a Project: run `pnpm template-upgrade`; it takes `docs/agents/scripts.md` and `docs/agents/authn.md`.
