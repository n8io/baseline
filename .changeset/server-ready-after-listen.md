---
"app": patch
---

The server reports ready on `/readyz` only once it is listening on `PORT`. Before, it marked itself ready as soon as it asked to listen, so a server about to crash on `EADDRINUSE` could answer `/readyz` 200 for a moment. A listen error now always ends in a logged crash and exit code 1 without a ready report, and the `Server listening and ready` log line marks the moment. The API-only server from `docs/agents/pieces.md` gets the same order, since it reports ready from the same listener.
