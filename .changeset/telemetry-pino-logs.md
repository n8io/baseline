---
"@n8io/baseline-telemetry": minor
---

The preload no longer creates the app's logger before the SDK starts, so pino records now reach the OTLP log exporter. Telemetry imports `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.
