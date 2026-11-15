---
"app": patch
---

`server-ready.test.ts` no longer fails now and then on a busy 2-CPU runner with "timed out waiting for the exit". The test that takes PORT before the server starts waited 10 s for the exit, but the exit comes only after a whole boot, which takes 10 to 12 s there. It now allows `productionServerBootMs` (20 s), the same allowance every other boot wait in `test/integration/production-server.ts` uses, so a server that hangs instead of exiting still fails.

To upgrade a Project: run `pnpm template-upgrade`; it takes `test/integration/production-server.ts` and `test/integration/server-ready.test.ts`.
