---
"@n8io/baseline-analytics": patch
---

The `vendor` key check in `analyticsMixpanelCreate` now calls `sharedVendorKeyRefused` from `@n8io/baseline-shared`. Behaviour is unchanged: the same `TypeError` for a `vendor` key other than `host`.
