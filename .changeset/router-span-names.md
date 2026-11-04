---
"@n8io/baseline-telemetry": patch
---

Loader and action spans are now named after the route that owns them (`loader root`, `loader routes/foo-list`) rather than the request's pattern, which gave every matched route's loader the same name. `http.route` and the server span name now start with a slash (`GET /foos`, `GET /` for the index), as the HTTP semantic conventions require.
