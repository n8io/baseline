---
"@n8io/baseline-queue": patch
---

The `vendor` key check in `queueMigrate` and `queueSchedulesSync` now calls `sharedVendorKeyRefused` from `@n8io/baseline-shared`. Behaviour is unchanged: the same `TypeError` for a `vendor` key other than `application_name`, `options` and `ssl`.
