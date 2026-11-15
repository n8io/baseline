# @n8io/baseline-telemetry

## 2.0.0

### Major Changes

- a278133: Four small gaps, found building the showcase app.
  - cache: `cacheCreate(store, { keyOf, prefix, schema })` returns a cache whose `set(value)` takes the value alone, so a Domain no longer needs a wrapper to turn `set(id, value)` into `set(value)`.
  - queue: `@n8io/baseline-queue/testing` exports `queueTestConsumerRun({ consumer, data, eventId? })`, which runs one Event through a Consumer as the worker does. `queueCreate` on a database that was never migrated now says "the queue schema is missing in this database: run queueMigrate (pnpm migrate)", with pg-boss's error as `cause`.
  - live: `useLiveUpdates({ channel, id: string | null })`; a `null` id opens no stream.
  - telemetry (breaking): a signal with no `OTEL_<SIGNAL>_EXPORTER` and no OTLP endpoint (`OTEL_EXPORTER_OTLP_ENDPOINT` or the signal's own) now exports nothing. Before, it exported to `localhost:4318`, and every script waited about 9 s at exit for a collector that was not there.

  To upgrade a Project: if you relied on the default `localhost:4318` with no endpoint variable, set `OTEL_EXPORTER_OTLP_ENDPOINT` where you run a collector. The Template's `.env.development` already does.

### Minor Changes

- a217e91: `telemetryShutdown` no longer holds a process open for about 9 s when an OTLP endpoint is set and no collector listens. The final export waits at most one exporter timeout (1 s by default), then shutdown resolves and prints one warning naming the endpoint (without credentials). OTLP exporters now time out after 1 s instead of 10 s, so a collector that takes longer than 1 s to answer loses its batches and a failed export is retried at most once; set `OTEL_EXPORTER_OTLP_TIMEOUT` (milliseconds, or the signal's own) higher for such a collector.

## 1.4.0

### Minor Changes

- 31cc578: Outlast the load balancer's idle timeout, and stop tracing idle polls.
  - http: `httpServerKeepAlive(server)` keeps idle connections open for 65 s (Node's default is 5 s) and gives headers 66 s. A load balancer with the usual 60 s idle timeout no longer reuses a connection the pod has closed, which the client saw as an occasional 502. Keep the balancer's idle timeout under 65 s.
  - app: `src/server.ts` calls `httpServerKeepAlive(server)` first in `serverServe`. A Project adds that line and its import on upgrade.
  - health: the probe server keeps idle connections for 65 s too, and `close()` now drops every open connection, so a half-sent probe cannot hold shutdown.
  - telemetry: pg and Redis spans are made only inside a trace (`requireParentSpan`). A query in a request, a Consumer or Schedule run or a use case keeps its span; a queue poll, boot or maintenance query makes none. Redis still makes one `redis-connect` span per connection it opens. pg's metrics follow its spans: `db.client.operation.duration` counts only queries inside a trace, and a pool's `db.client.connection.*` metrics start with its first query inside a trace.

## 1.3.0

### Minor Changes

- 1137ee3: Three more Package surfaces stop naming a vendor.

  `@n8io/baseline-live`: `liveStreamCreate({ liveHub, channel, id, expiresAt, signal })` no longer takes a Hono context. It answers a web `Response` for any server, and the `hono` peer is gone. Pass the request's `signal` (`c.req.raw.signal` in Hono) so the stream ends when the request is aborted. A page that stops reading is dropped once 64 KiB wait for it. The response no longer sends `Connection: keep-alive`, which HTTP/2 forbids.

  `@n8io/baseline-postgres`: `postgresPoolCreate` takes `{ databaseUrl, max?, connectTimeoutMs? }`, not pg's `PoolConfig`. The Package exports `PostgresPool` and `PostgresClient`; name those in your own signatures. They are still pg's pool and client, because Drizzle needs the real ones. Other `PoolConfig` overrides (`ssl`, `idleTimeoutMillis` and the rest) are no longer accepted; put them in the database URL where pg reads them, or ask for an option.

  `@n8io/baseline-telemetry`: the new `@n8io/baseline-telemetry/span` entry exports `telemetrySpanAttributesSet(attributes)` and `telemetrySpanRun(name, work)`.

  In the Template, no file in `src/` imports `@opentelemetry/api` or `pg`: Use cases set span attributes with `telemetrySpanAttributesSet`, and architecture rules A8 and A21 enforce it. Architecture rule A16 now reads `telemetrySpanAttributesSet` and also allows a `baseline.<domain>.<thing>_count` key. When you upgrade: remove the first argument of each `liveStreamCreate` call, pass `signal` and answer with `c.newResponse(live.body, live)` as Foo's `api/foo-live.ts` does (a bare `Response` loses headers that middleware set with `c.header()`), replace `trace.getActiveSpan()?.setAttributes(...)` with `telemetrySpanAttributesSet(...)` and a hand-written child span with `telemetrySpanRun`, replace `pg.Pool` with `PostgresPool`, and rename a `connectionTimeoutMillis` override to `connectTimeoutMs`.

### Patch Changes

- Updated dependencies [d63058e]
  - @n8io/baseline-logger@3.0.0

## 1.2.1

### Patch Changes

- 5985c99: Docs match the code: the telemetry README shows the one preload file the Template uses (no `--experimental-loader`), the result README shows errors as `Error` subclasses with a `type` field, the queue Consumer example passes a machine Actor, the glossary adds Inbox and Repository, and `grafana/otel-lgtm` is pinned to a version tag.
- 80f3783: The preload registers the OpenTelemetry ESM loader hook in-thread with `register()` from `import-in-the-middle/register-hooks.mjs` (`module.registerHooks`), so Node 26 no longer prints `[DEP0205] module.register() is deprecated` at startup. To match in your Project, replace `@opentelemetry/instrumentation` with `import-in-the-middle` (`^3.6.0`) in package.json and change `src/preload.ts` to:

  ```ts
  import { register } from "import-in-the-middle/register-hooks.mjs";
    register();
  await import("@n8io/baseline-telemetry/register");
  ```

  `@n8io/baseline-telemetry` no longer lists `@opentelemetry/instrumentation` as a direct dependency; its instrumentations still bring it.
- Updated dependencies [5985c99]
  - @n8io/baseline-result@1.1.1

## 1.2.0

### Minor Changes

- daecd9a: The @n8io/baseline-* packages publish publicly to npmjs, so installs need no npm token. Projects drop the `@n8io:registry` line from `.npmrc`, and the image builds with no `packages_token` secret.
- b73602b: Telemetry now builds the metric reader itself, like the span and log processors: `OTEL_METRICS_EXPORTER` (`otlp` by default, `console` or `none`) and `OTEL_METRIC_EXPORT_INTERVAL` choose a periodic reader. Every signal exports OTLP over http/protobuf only; the grpc and http/json exporters are gone, and an `OTEL_EXPORTER_OTLP_*PROTOCOL` set to anything else prints one warning at start. The app's integration tests read OTLP protobuf and prove the use case duration metric reaches a collector.

### Patch Changes

- 6e5f6e7: baseline is open source under the MIT license, and every package declares `"license": "MIT"`. The template is fetched over plain HTTPS, so `domain-create` and `template-upgrade` no longer need a `gh` login; `app-create` needs one only to create the project repo.
- 793ad13: Each package ships a README on npmjs: what it does, how to install it, its exports, an example, and the env vars and peers it needs.
- 33c61e9: Loader and action spans are now named after the route that owns them (`loader root`, `loader routes/foo-list`) rather than the request's pattern, which gave every matched route's loader the same name. `http.route` and the server span name now start with a slash (`GET /foos`, `GET /` for the index), as the HTTP semantic conventions require.
- Updated dependencies [daecd9a]
- Updated dependencies [6e5f6e7]
- Updated dependencies [793ad13]
  - @n8io/baseline-logger@2.1.0
  - @n8io/baseline-result@1.1.0

## 1.1.1

### Patch Changes

- Updated dependencies [b99f091]
  - @n8io/baseline-logger@2.0.0

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
