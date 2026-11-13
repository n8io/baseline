---
"@n8io/baseline-live": major
"@n8io/baseline-postgres": major
"@n8io/baseline-telemetry": minor
"app": major
---

Three more Package surfaces stop naming a vendor.

`@n8io/baseline-live`: `liveStreamCreate({ liveHub, channel, id, expiresAt, signal })` no longer takes a Hono context. It answers a web `Response` for any server, and the `hono` peer is gone. Pass the request's `signal` (`c.req.raw.signal` in Hono) so the stream ends when the request is aborted. A page that stops reading is dropped once 64 KiB wait for it.

`@n8io/baseline-postgres`: `postgresPoolCreate` takes `{ databaseUrl, max?, connectTimeoutMs? }`, not pg's `PoolConfig`. The Package exports `PostgresPool` and `PostgresClient`; name those in your own signatures.

`@n8io/baseline-telemetry`: the new `@n8io/baseline-telemetry/span` entry exports `telemetrySpanAttributesSet(attributes)` and `telemetrySpanRun(name, work)`.

In the Template, no file in `src/` imports `@opentelemetry/api` or `pg`: Use cases set span attributes with `telemetrySpanAttributesSet`, and architecture rules A8 and A21 enforce it. When you upgrade: drop the first argument of each `liveStreamCreate` call and pass `signal`, replace `trace.getActiveSpan()?.setAttributes(...)` with `telemetrySpanAttributesSet(...)` and a hand-written child span with `telemetrySpanRun`, replace `pg.Pool` with `PostgresPool`, and rename a `connectionTimeoutMillis` override to `connectTimeoutMs`.
