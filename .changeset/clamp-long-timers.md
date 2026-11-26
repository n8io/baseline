---
"@n8io/baseline-shared": patch
"@n8io/baseline-shutdown": patch
"@n8io/baseline-queue": patch
"@n8io/baseline-analytics": minor
---

`sharedTimeRace` and `sharedTimeLimit` now wait the full duration for a delay over 2147483647 ms (they fired after about 1 ms), and `sharedTimeTimer` is new. Shutdown clears its default timers when a run ends. `queueMigrate` throws after `indexesDeadlineMs` (default 10 minutes) when pg-boss's index builds stay busy. `analyticsLoggerCreate` takes a `logger` option.
