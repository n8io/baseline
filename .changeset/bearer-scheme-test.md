---
"app": patch
---

A Project now keeps the test that the OpenAPI document declares the bearer scheme and requires it on every operation. It moved out of the example (foo) block of `server-wiring.test.ts` into the base "security guards" block, so removing the Domain no longer removes it. The same block gains a test that a bearer request to /api passes whatever its Origin, and a test that the document is served without a token. On a template upgrade a Project gets these tests; To upgrade a Project: run `pnpm template-upgrade`; it takes `test/integration/server-wiring.test.ts`.
