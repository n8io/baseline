---
"@n8io/baseline-telemetry": patch
"@n8io/baseline-result": patch
"@n8io/baseline-queue": patch
"app": patch
---

Docs match the code: the telemetry README shows the one preload file the Template uses (no `--experimental-loader`), the result README shows errors as `Error` subclasses with a `type` field, the queue Consumer example passes a machine Actor, the glossary adds Inbox and Repository, and `grafana/otel-lgtm` is pinned to a version tag.
