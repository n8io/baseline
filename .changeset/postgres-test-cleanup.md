---
"app": patch
---

A Domain's Postgres repository test drops its per-test databases in parallel, so the drops share one Postgres checkpoint instead of waiting on one each, and the integration project's `hookTimeout` is 30 s as a guard. A slow checkpoint no longer times out the file's `afterAll`. To pick it up in an existing Domain, copy the `closes` and `drops` lines from the Template's repository test into yours.
