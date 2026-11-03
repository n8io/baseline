---
"@n8io/baseline-logger": minor
---

Adds the `@n8io/baseline-logger/err-serialize` subpath with `loggerErrSerialize` and `LoggerErr`. Importing it creates no logger and loads no pino, so a preload can serialize errors without loading pino before OpenTelemetry starts.
