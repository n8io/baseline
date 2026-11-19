---
"app": patch
---

An `/api` DELETE with no body, or a chunked request, no longer answers 500 on the Node server (production build and `pnpm dev`). hono's bodyLimit copies a request whose length it must measure with `new Request(raw, init)`, and the Node adapter's request is not a native one; `src/server.ts` now hands it a native copy first. A body over 1 MB still answers 413 `PayloadTooLarge`.
