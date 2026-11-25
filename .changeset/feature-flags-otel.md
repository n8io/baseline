---
"@n8io/baseline-feature-flags": minor
"@n8io/baseline-telemetry": minor
---

The server's LaunchDarkly flags now record every read as the OpenTelemetry `feature_flag.evaluation` log record (key, provider name, reason, variant or a small value, `error.type` on a fallback), found by the request's trace and never carrying a context. A flag service outage is logged once when it starts and once when reads recover, not on every read. `@n8io/baseline-telemetry/feature-flag` is the new entry that records it.
