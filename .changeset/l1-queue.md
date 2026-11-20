---
"@n8io/baseline-queue": minor
---

Export `QueueSchedulesSyncVendorOptions` (the keys `queueMigrate` takes). A Queue from elsewhere now throws `<function>: queue must come from queueCreate`, and an Event published without a key `publish: key must not be empty (Event <name>)`.
