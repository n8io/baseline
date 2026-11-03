# @n8io/baseline-telemetry

## 1.1.0

### Minor Changes

- b8aa31f: The preload no longer creates the app's logger before the SDK starts, so pino records now reach the OTLP log exporter. Telemetry imports `loggerErrSerialize` from `@n8io/baseline-logger/err-serialize`.

### Patch Changes

- Updated dependencies [b8aa31f]
  - @n8io/baseline-logger@1.1.0

## 1.0.0

### Major Changes

- 81a9ef4: First release of the twelve shared packages.

### Patch Changes

- Updated dependencies [81a9ef4]
  - @n8io/baseline-logger@1.0.0
  - @n8io/baseline-result@1.0.0
