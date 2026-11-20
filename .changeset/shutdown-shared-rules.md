---
"@n8io/baseline-shutdown": minor
---

shutdown follows the shared Package rules. `ShutdownOptions` is exported. `deadlineMs` and `drainDelayMs` take `null`, which means the default as leaving them out does. `shutdownHandleCreate` throws a `TypeError` starting `shutdownHandleCreate:` on a `deadlineMs` under 5000 (the intake cutoff would come at once) or a `drainDelayMs` that is not a whole number; both did the wrong thing before. Every export has a doc comment, the body lives in `shutdown-handle.ts`, and the README example reads the Template's `SHUTDOWN_DRAIN_DELAY_MS` and tells a Project how to test around the handle.
