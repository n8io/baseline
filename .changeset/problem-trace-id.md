---
"@n8io/baseline-http": minor
---

Every problem+json body now carries `traceId`, the trace id of the request's active span, so a caller can report it and you can find the request's spans and logs (`trace_id`) by it. It is left out when nothing traces the request.
