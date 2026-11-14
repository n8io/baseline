---
"@n8io/baseline-telemetry": minor
---

`telemetryShutdown` no longer holds a process open for about 9 s when an OTLP endpoint is set and no collector listens. The final export waits at most one exporter timeout (1 s by default), then shutdown resolves and prints one warning naming the endpoint (without credentials). OTLP exporters now time out after 1 s instead of 10 s, so a collector that takes longer than 1 s to answer loses its batches and a failed export is retried at most once; set `OTEL_EXPORTER_OTLP_TIMEOUT` (milliseconds, or the signal's own) higher for such a collector.
