---
"app": patch
---

The unit test project gives hooks 20 s, like its tests. Importing `server.ts` in a `beforeAll` took over the default 10 s on a busy CI runner.
