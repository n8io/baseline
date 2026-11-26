---
"@n8io/baseline-shutdown": minor
"@n8io/baseline-error-tracking": minor
---

`shutdownHandleCreate` takes `host.logger` and `errorTrackingSentryCreate` takes `logger`, each defaulting to the Package logger, so a test passes a plain object instead of reassigning a method of the logger.
