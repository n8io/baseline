---
"@n8io/baseline-analytics": minor
---

analytics follows the shared Package rules. `AnalyticsMixpanelOptions` is exported, and `vendor` and `vendor.host` take `null`, which means the default. `analyticsMixpanelCreate` now throws a `TypeError` on a `vendor` key other than `host`, which did nothing before (the type already refused it), and its messages start with `analyticsMixpanelCreate:`. Every export has a doc comment, and the README names `analyticsLoggerCreate` as the Package's stand-in.
