---
"@n8io/baseline-feature-flags": minor
---

`featureFlagsLaunchDarklyClientOrigins({ vendor? })` from `/launchdarkly/client` returns the origins the browser client reaches (LaunchDarkly's own, or those of `vendor.baseUri`, `vendor.streamUri` and `vendor.eventsUri`), for the page's CSP `connect-src`. Without them the browser blocks every LaunchDarkly request and each flag reads as its fallback.
