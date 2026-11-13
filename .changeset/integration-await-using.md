---
"app": patch
---

Integration tests close what they open with `await using`. The integration database, the app process the server and worker helpers start, the OTLP receiver and the slow request now dispose themselves (`drop`, `stop`, `close` and `abort` still work), so a test declares each one with `await using` (`using` for the slow request) and they close in reverse order: the process stops before its database is removed. Those tests now get 60 s, since teardown counts against the test timeout. The `cleanups` arrays and their `afterEach` hooks are gone.
