# @n8io/baseline-logger

## 1.1.0

### Minor Changes

- b8aa31f: Adds the `@n8io/baseline-logger/err-serialize` subpath with `loggerErrSerialize` and `LoggerErr`. Importing it creates no logger and loads no pino, so a preload can serialize errors without loading pino before OpenTelemetry starts.

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.
