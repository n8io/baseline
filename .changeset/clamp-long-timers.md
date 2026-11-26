---
"@n8io/baseline-shared": patch
"@n8io/baseline-shutdown": patch
"@n8io/baseline-queue": patch
"@n8io/baseline-analytics": minor
---

`sharedTimeRace` and `sharedTimeLimit` now wait the full duration for a delay over 2147483647 ms (they fired after about 1 ms), and `sharedTimeTimer` is new. Shutdown clears its default timers when a run ends. `queueMigrate` still waits as long as pg-boss's index builds take; a new optional `indexesDeadlineMs` makes it throw after that many ms, and sets no limit by default. `analyticsLoggerCreate` takes a `logger` option.
