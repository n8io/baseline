---
"@n8io/baseline-queue": patch
---

`queueMigrate` now gives up on pg-boss's index builds after 10 minutes by default (`indexesDeadlineMs` defaults to 600000) instead of waiting with no deadline. Pass a larger `indexesDeadlineMs` to wait longer; there is no unlimited value.
