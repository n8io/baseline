---
"@n8io/baseline-telemetry": patch
---

telemetry follows the shared Package rules: every export has a doc comment, one private helper marks a span failed for `telemetrySpanRun`, `telemetryUseCasesTrace` and the router instrumentation, and the README says `/span` is for a Project's Use cases (Packages use `@opentelemetry/api`).
