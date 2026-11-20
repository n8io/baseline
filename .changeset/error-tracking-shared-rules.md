---
"@n8io/baseline-error-tracking": minor
---

error-tracking follows the shared Package rules. `vendor` takes `null`, which means the default. `errorTrackingSentryCreate`'s `TypeError` messages start with `errorTrackingSentryCreate:`. Every export has a doc comment, and the README example guards an unset `SENTRY_DSN` and tells a Project how to test code that reports, with no stubs.
