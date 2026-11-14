---
"@n8io/baseline-cache": minor
"@n8io/baseline-queue": minor
"@n8io/baseline-live": minor
"@n8io/baseline-telemetry": major
---

Four small gaps, found building the showcase app.

- cache: `cacheCreate(store, { keyOf, prefix, schema })` returns a cache whose `set(value)` takes the value alone, so a Domain no longer needs a wrapper to turn `set(id, value)` into `set(value)`.
- queue: `@n8io/baseline-queue/testing` exports `queueTestConsumerRun({ consumer, data, eventId? })`, which runs one Event through a Consumer as the worker does. `queueCreate` on a database that was never migrated now says "the queue schema is missing in this database: run queueMigrate (pnpm migrate)", with pg-boss's error as `cause`.
- live: `useLiveUpdates({ channel, id: string | null })`; a `null` id opens no stream.
- telemetry (breaking): a signal with no `OTEL_<SIGNAL>_EXPORTER` and no OTLP endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT` or the signal's own) now exports nothing. Before, it exported to `localhost:4318`, and every script waited about 9 s at exit for a collector that was not there.

To upgrade a Project: if you relied on the default `localhost:4318` with no endpoint variable, set `OTEL_EXPORTER_OTLP_ENDPOINT` where you run a collector. The Template's `.env.development` already does.
