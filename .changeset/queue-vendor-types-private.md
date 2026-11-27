---
"@n8io/baseline-queue": major
---

`QueueVendorOptions`, `QueueMigrateVendorOptions` and `QueueSchedulesSyncVendorOptions` are no longer exported, so no public type names a pg-boss type. The `vendor` option of `queueCreate`, `queueMigrate` and `queueSchedulesSync` takes the same keys as before: write the object inline in the Project's wiring file (`src/queue-open.ts`, `src/migrate.ts`), or take `NonNullable<QueueOptions["vendor"]>` and its like. The vendor-public-types test now covers this Package.
