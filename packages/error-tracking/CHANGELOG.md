# @n8io/baseline-error-tracking

## 1.0.0

### Major Changes

- 3348934: Add `@n8io/baseline-error-tracking`: Error reports sent to Sentry (through `@sentry/core`) with their class name, stack, cause chain, error code and trace id, never their message. `@n8io/baseline-logger` gains `loggerErrorListen`, which hears every error logged at error or fatal, so the Template reports HTTP 500s, failed jobs and crashes without changing a caller. The Template reads an optional `SENTRY_DSN` (without it, errors are only logged) and removes it all with `pnpm piece-remove error-tracking`.

### Patch Changes

- Updated dependencies [3348934]
  - @n8io/baseline-logger@3.1.0
