---
"@n8io/baseline-shared": minor
"@n8io/baseline-cache": patch
"@n8io/baseline-feature-flags": patch
"@n8io/baseline-health": patch
"@n8io/baseline-http": patch
"@n8io/baseline-live": patch
"@n8io/baseline-postgres": patch
"@n8io/baseline-queue": patch
"@n8io/baseline-redis": patch
"@n8io/baseline-sdk": patch
"@n8io/baseline-shutdown": patch
"app": patch
---

Share the helpers the Packages each wrote their own copy of, through the new `@n8io/baseline-shared`.

- shared: new Package with the timeout race (`sharedTimeLimit`, `sharedTimeRace`), the integer option check (`sharedIntegerAssert`), the 2147483647 timer limit, the server keep-alive timeouts and the Postgres connection checks. It has no dependencies and is for the Packages, not for a Project.
- redis, cache, live, feature-flags: use the one timeout race instead of six hand-written ones.
- cache, feature-flags, health, queue, postgres, shutdown, sdk: option errors now come from one formatter, so a bad number reads `<function>: <option> must be a whole number from 1 to N, found X` (or `, N or more`); the same inputs still throw a `TypeError`.
- health, http: one owner for the 65 s keep-alive; `httpServerKeepAlive` is unchanged.
- queue, postgres: one copy of the Postgres URL and TLS checks.
- sdk: ky does the waiting on `Retry-After` and rate-limit headers; the hand-written backoff and header parsing are gone. A wait that runs past `totalTimeoutMs` now ends in the `TimeoutError` instead of resolving the 429 or 503 at once.
