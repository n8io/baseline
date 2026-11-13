---
"@n8io/baseline-error-tracking": major
"@n8io/baseline-logger": minor
"app": minor
---

Add `@n8io/baseline-error-tracking`: Error reports sent to Sentry with their class name, stack, cause chain and trace id, never their message. `@n8io/baseline-logger` gains `loggerErrorListen`, which hears every error logged at error or fatal, so the Template reports HTTP 500s, failed jobs and crashes without changing a caller. The Template reads an optional `SENTRY_DSN` (without it, errors are only logged) and removes it all with `pnpm piece-remove error-tracking`.
