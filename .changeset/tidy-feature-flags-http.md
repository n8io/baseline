---
"@n8io/baseline-http": major
"@n8io/baseline-feature-flags": minor
"@n8io/baseline-sdk": patch
"@n8io/baseline-live": patch
"@n8io/baseline-authn": patch
"app": patch
---

Tidy feature flags and secure headers.

- http: remove the `httpSecureHeaders` constant. Use `httpSecureHeadersCreate()` (same headers, no extra origins).
- feature-flags: drop the unused `@openfeature/core` peer and the `@n8io/baseline-telemetry` dependency (the evaluation log record now goes through `@opentelemetry/api`, an optional peer of the server adapter); add the `/launchdarkly/origins` entry so a server loads the CSP origins without the browser SDKs (`/launchdarkly/client` still re-exports it); throw a `TypeError` from both factories on an empty key or a `readyTimeoutMs` that is not a whole number of milliseconds from 1 to 2147483647 (0, negative and fractional values were accepted before, and now fail at boot); record evaluations under the instrumentation scope `@n8io/baseline-feature-flags` instead of `@n8io/baseline-telemetry`; export `FeatureFlagsFallbackOptions`, `FeatureFlagsOnFallback` and `FeatureFlagsLaunchDarklyClientVendorOptions`.
- feature-flags, sdk, live, authn: add `sideEffects: false` so bundlers can tree-shake them.
