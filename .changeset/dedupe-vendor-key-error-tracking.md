---
"@n8io/baseline-error-tracking": patch
---

The `vendor` key check in `errorTrackingSentryCreate` now calls `sharedVendorKeyRefused` from `@n8io/baseline-shared`. Behaviour is unchanged: the same `TypeError` for a `vendor` key other than `release`, `dist` and `sampleRate`.
