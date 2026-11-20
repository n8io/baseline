---
"@n8io/baseline-shutdown": minor
---

shutdown follows the shared Package rules. `ShutdownOptions` is exported. `deadlineMs` and `drainDelayMs` take `null`, which means the default as leaving them out does. `shutdownHandleCreate` throws a `TypeError` starting `shutdownHandleCreate:` on a `deadlineMs` that is not an integer over 5000, or a `drainDelayMs` that is not a whole number under `deadlineMs` minus 5000: with those, the intake cutoff came at once and every intake was cut. Every export has a doc comment, the body lives in `shutdown-handle.ts`, and the README example reads the Template's `SHUTDOWN_DRAIN_DELAY_MS` and tells a Project how to test around the handle.
