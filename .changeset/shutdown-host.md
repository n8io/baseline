---
"@n8io/baseline-shutdown": minor
---

Add a `host` option to `shutdownHandle` (`exit`, `on` and `sleep`, default the real `process.exit`, `process.on` and `setTimeout`), so a test drives a shutdown without fake timers. Exports `ShutdownHost`.
