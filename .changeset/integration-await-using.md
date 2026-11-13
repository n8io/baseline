---
"app": patch
---

Integration tests close what they open with `await using`. The integration database, the app process the server and worker helpers start, the OTLP receiver and the slow request now dispose themselves (`drop`, `stop`, `close` and `abort` still work), so a test declares each one with `await using` and they close in reverse order: the process stops before its database drops. The `cleanups` arrays and their `afterEach` hooks are gone.
