# OpenTelemetry across the stack

Research for [#5](https://github.com/n8io/baseline/issues/5). Researched 2026-10-31 against primary sources: opentelemetry-js and its CHANGELOGs, opentelemetry-js-contrib, opentelemetry-browser, opentelemetry.io, Hono middleware source, Drizzle published packages, React Router docs and CHANGELOG.

Evidence is tagged:

- **[source]** read in the owner's repo, docs or published package.
- **[tested]** I ran it (Node 22.22.1, scratch project, not committed).
- **[inferred]** reasoned from the above, not run.

## Short answer

Use `@opentelemetry/sdk-node` 0.300 (the SDK packages are at 3.0) started from a preload file, with the ESM loader hook. Use the contrib pg and Redis instrumentations, `instrumentation-http` and `instrumentation-undici`. Add no Drizzle-specific instrumentation, because Drizzle emits no spans. Name Hono routes by hand (a few lines of middleware) rather than adding `@hono/otel`, which doubles server spans on Node. Use React Router's `instrumentations` API for loaders and actions. Send logs through the logger's OTel instrumentation (pino or winston), not through the Logs API in app code. In the browser use the new `opentelemetry-browser` packages, which are experimental, and accept that.

Almost everything on the Node side except the core API/SDK is `0.x`/experimental. Pin exact versions and expect breaking changes.

## Current versions (npm, 2026-10-31)

| Package | Version | Notes |
|---|---|---|
| `@opentelemetry/api` | 1.10.0 | Logs API now lives here |
| `@opentelemetry/sdk-trace`, `sdk-logs`, `sdk-metrics`, `resources`, `core` | 3.0.0 | Stable. Released 2026-10-20 |
| `@opentelemetry/sdk-node` | 0.300.0 | Experimental package line, but the recommended entry point |
| `@opentelemetry/instrumentation-http` | 0.300.0 | |
| `@opentelemetry/instrumentation-undici` | 0.34.0 | |
| `@opentelemetry/instrumentation-pg` | 0.77.0 | |
| `@opentelemetry/instrumentation-ioredis` / `-redis` | 0.72.0 / 0.72.0 | |
| `@opentelemetry/instrumentation-pino` / `-winston` | 0.70.0 / 0.69.0 | |
| `@opentelemetry/browser-instrumentation` / `browser-sdk` | 0.10.0 / 0.7.0 (released 2026-10-30; npm showed 0.9.0 / 0.6.0 at research time) | New browser packages |
| `@hono/otel` | 1.3.0 | |
| `@opentelemetry/semantic-conventions` | 1.44.0 | |
| `hono` 4.13.14, `drizzle-orm` 0.45.4 (latest; 1.0.0-rc.5 exists), `react-router` 8.5.1 | | |

## Things that changed recently and will trip an old tutorial

All [source] from `opentelemetry-js/CHANGELOG.md`, `experimental/CHANGELOG.md` and `doc/3.x/migration-guide.md` unless marked.

- **3.0.0 (2026-10-20)** raised the minimum Node to **>=22.15.0**. The template's runtime must be Node 22.15 or newer.
- `sdk-trace-base`, `sdk-trace-web` and `sdk-trace-node` are gone. Everything is `@opentelemetry/sdk-trace`. `TracerProvider` replaces `NodeTracerProvider`/`WebTracerProvider`.
- Span processors now take an options object: `new SimpleSpanProcessor({ exporter })` and `new BatchSpanProcessor({ exporter })`. Passing the exporter directly silently exports nothing. I hit this. [tested]
- `@opentelemetry/sdk-logs` is **stable** as of 3.0.0. The opentelemetry-js README feature table says Traces, Metrics and Logs are all Stable for API and SDK. The opentelemetry.io JS page still says Logs is "Development" (page fetched 2026-10-31), so the website lags the repo.
- The standalone `@opentelemetry/api-logs` package was removed in 0.300.0. The Logs API is in `@opentelemetry/api` 1.10.0.
- Packages ship dual CJS/ESM with an `exports` map. Deep imports into `build/` no longer resolve.
- `sdk-node` no longer re-exports `api`, `core`, `resources` etc. Import from the real packages. Its peer dependency is `@opentelemetry/api >=1.10.0 <1.11.0`, so pin `api` to 1.10.x.
- `NodeSDK` config fields `spanProcessor`, `metricReader`, `logRecordProcessor` (singular) were removed. Use the plural arrays.
- The Jaeger exporter and propagator, the OpenTracing shim and the OpenCensus shim are removed. Use OTLP and W3C trace context.
- Declarative config (`startNodeSdk()`) exists but is experimental. `new NodeSDK()` is still what the docs recommend.
- `instrumentation-http` 0.222 and later uses the stable HTTP semantic conventions by default. There is no `OTEL_SEMCONV_STABILITY_OPT_IN` switch left for HTTP. The pg, ioredis and redis instrumentations (0.68+/0.72+) emit stable database conventions (`db.system.name`, `db.query.text`).

## Node SDK under ESM

The loader hook is still required. [source] `opentelemetry-js/doc/esm-support.md`: ESM apps need `--import ./telemetry.js` **and** `--experimental-loader=@opentelemetry/instrumentation/hook.mjs`. The doc says this will eventually move to `module.register()` ([issue 4933](https://github.com/open-telemetry/opentelemetry-js/issues/4933)) and that `import-in-the-middle/hook.mjs` must not be used directly.

What I measured [tested], ESM app with Hono on `@hono/node-server`:

- **Without the hook**, `instrumentation-http` produced no server spans at all. `instrumentation-undici` still worked, because it uses `diagnostics_channel` instead of patching modules.
- **With the hook**, http server and client spans appear.
- `pg` is CommonJS and was patched with or without the hook.
- The hook prints an `ExperimentalWarning` on Node 22 (`--no-warnings` hides it).
- The hook is resolved relative to the working directory. Run from the project root or pass a `file://` URL.

Shape of the startup file (`telemetry.ts`, preloaded):

```ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
// Redis: IORedisInstrumentation or RedisInstrumentation, matching the client the cache adapter uses.

new NodeSDK({
  // Exporters, resource and sampler come from OTEL_* environment variables.
  instrumentations: [
    new HttpInstrumentation(),
    new UndiciInstrumentation(),
    new PgInstrumentation(),
    new PinoInstrumentation(),
  ],
}).start();
```

Run: `node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./dist/telemetry.js ./dist/server.js` (in dev with `tsx`, use `--import` only for the TS file, per the same doc: "To use `tsx` ... the `--import` flag must be used"; the doc warns "results may vary" for TypeScript under loaders).

`@opentelemetry/auto-instrumentations-node` 0.82 also works (it bundles all of these, including undici, pg, redis, ioredis, pino, winston, runtime-node), but it patches every library it knows. For a template, list instrumentations explicitly. Fewer surprises, smaller install, and the agent sees exactly what is on.

The exporter, endpoint and service name are configured with the standard `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` variables. The Grafana image (`grafana/otel-lgtm`, v0.39.0) listens on 4317 (gRPC) and 4318 (HTTP) and documents `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318`. [source]

## Stability, per piece

| Piece | Package | Status | Evidence |
|---|---|---|---|
| Trace/metrics/logs API and SDK | `api`, `sdk-trace`, `sdk-metrics`, `sdk-logs` | Stable (1.x/3.x) | CHANGELOG, README |
| Node SDK wrapper | `sdk-node` | 0.x, experimental line, but the documented entry point | npm, docs |
| HTTP server/client | `instrumentation-http` | 0.x. Stable HTTP semconv | README |
| Outgoing `fetch` (Node) | `instrumentation-undici` | 0.x, README says "experimental package under active development" | contrib README |
| Postgres | `instrumentation-pg` | 0.x. Stable DB semconv. Supports `pg` `>=8.0.3 <9` | contrib README |
| Redis | `instrumentation-ioredis` (`ioredis >=2 <7`), `instrumentation-redis` (`redis >=2.6 <7`) | 0.x. Stable DB semconv | contrib README |
| Logger bridge | `instrumentation-pino` (`pino >=5.14 <11`, log sending needs 7+), `instrumentation-winston` | 0.x | contrib README |
| Hono | `@hono/otel` | 1.x, community package | npm, source |
| React Router loaders/actions | React Router `instrumentations` | Stable API since v7.15.0 | CHANGELOG |
| Browser fetch/XHR, events | `@opentelemetry/browser-instrumentation` | experimental (all entry points are under `/experimental/`) | opentelemetry-browser README |
| Browser SDK | `@opentelemetry/browser-sdk` | experimental | README |
| Database semantic conventions | | "Mixed" status on opentelemetry.io | semconv page |

Postgres through Drizzle is covered by the table row for `pg`. Drizzle needs no row of its own (next section).

## Postgres through Drizzle

**Drizzle emits no OpenTelemetry spans.** [source] In `drizzle-orm@0.45.4` (published) `tracing.js` has `let otel;` that is never assigned (the `import('@opentelemetry/api')` is commented out in source), so `tracer.startActiveSpan` always just calls the function. In `drizzle-orm@1.0.0-rc.5` it is `const hasTelemetry = false` and a tracer that does nothing. Some third-party pages claim Drizzle traces automatically; they are wrong for these versions.

What works: `instrumentation-pg` patches `pg` and `pg-pool`, and Drizzle's `node-postgres` driver sits on `pg`. [tested] A Drizzle `db.execute()` through a `pg.Pool` produced `pg-pool.connect` and `pg.connect` spans from `@opentelemetry/instrumentation-pg` and nothing from Drizzle. I could not run a full query (no database was available to me), but the `pg` client query path is the instrumentation's main job.

Consequences for the template:

- Use the `node-postgres` (`pg`) driver in the Postgres adapter. The `postgres` (postgres.js) driver has no official OTel instrumentation in contrib. If #12 picks postgres.js there are no DB spans without custom work. [inferred from the contrib package list]
- Query spans carry `db.query.text` and `db.operation.name`, but not table name (`db.collection.name`). The README says this is on purpose.
- `addSqlCommenterCommentToQueries` and `requireParentSpan` exist if wanted. Pool-connect spans are noisy; `ignoreConnectSpans: true` removes them.
- Other Drizzle drivers behave differently. An in-memory or PGlite adapter used in tests has no instrumentation. That is fine, but the port should not promise spans.

## Redis

Instrumentation exists for both common clients: `ioredis` (`>=2 <7`) and node-redis `redis` (`>=2.6 <7`; the older `instrumentation-redis-4` package was last published 2026-05 and is superseded by `instrumentation-redis`). The cache adapter's client choice (#12) decides which one to install. Both emit stable DB conventions. `instrumentation-redis` has a `dbStatementSerializer` option; the default serialization avoids sending command values. [source]

## Outgoing fetch

Node's global `fetch` is undici. `instrumentation-undici` 0.34 covers it and also `undici` the package (`>=5.12`), using `diagnostics_channel`, and it worked without the ESM hook. [tested] It injects `traceparent`. Spans end when the whole response body has been received. It is experimental, so pin it. Do not also enable `instrumentation-http` client spans for fetch: undici does not go through `http`, so there is no duplicate. [tested: the fetch calls produced undici spans only]

## Hono

Two options. I tested both on `@hono/node-server` with the hook.

**`@hono/otel` plus `instrumentation-http`: duplicate server spans.** [tested] Every request produced two `SERVER` spans, an `http` one named `GET` and a Hono one named `GET /users/:id`, as siblings under the same remote parent. `@hono/otel` creates its own `SpanKind.SERVER` span and extracts the parent from request headers [source: `packages/otel/src/index.ts`]. It also records its own `http.server.request.duration` metric, which `instrumentation-http` records too.

**Silencing the `http` server span with `ignoreIncomingRequestHook` does not work.** [tested] Returning `true` suppresses tracing for the whole request, including the `@hono/otel` span and every child span (the outgoing fetch vanished too). Do not use it as the fix.

**`instrumentation-http` alone gives a span named just `GET` with no `http.route`.** [tested] That is useless in a trace UI.

**Recommended: `instrumentation-http` plus a 10-line middleware** that renames the active span and sets the route after routing. [tested] Result was one server span named `GET /users/:id` with `http.route=/users/:id`, correct parent, and the outgoing fetch as its child:

```ts
import { trace } from '@opentelemetry/api';
import { routePath } from 'hono/route';

app.use(async (c, next) => {
  await next();
  const span = trace.getActiveSpan();
  if (span) {
    const route = routePath(c);
    span.setAttribute('http.route', route);
    span.updateName(`${c.req.method} ${route}`);
  }
});
```

Not tested: whether the `http.server.request.duration` metric picks up the route set this late. Check when building. `@hono/otel` is the right choice instead if the template ever runs off Node (Workers, Bun), where `instrumentation-http` does not apply. Its README says `sdk-node` does not work on Cloudflare Workers. The map says Node only.

Caveat for the combined mode: the React Router handler runs inside one catch-all Hono route, so Hono's `http.route` for SSR requests will be `*`. The React Router instrumentation below should supply the real route pattern.

## React Router loaders and actions

React Router has a first-party hook for this, so no OTel package is needed. [source] reactrouter.com instrumentation guide and `CHANGELOG.md`:

- Stabilized in **v7.15.0** (`unstable_instrumentations` became `instrumentations`, `unstable_pattern` became `pattern`). Current is 8.5.1.
- Framework mode server: `export const instrumentations = [...]` from `entry.server.tsx`. Client: `<HydratedRouter instrumentations={...} />`. Data mode: `createBrowserRouter(routes, { instrumentations })`. Declarative mode is not supported.
- Levels: `handler` (the whole request, server only), `router` (`navigate`, `fetch`), `route` (`loader`, `action`, `middleware`, `lazy`).
- Observe-only. You cannot change arguments or results. Errors come back as `{ status: 'error', error }` instead of throwing, so the span helper needs no try/catch. Errors thrown inside your instrumentation are swallowed.
- The docs include an OTel example using `trace.getTracer(...).startActiveSpan`. The docs' conditional-instrumentation sample references `request` out of scope; do not copy that part.
- Server handler results include the HTTP status and `meta.pattern` (route pattern), which is what to put in `http.route` and the span name.

[inferred] Make the server `handler` instrument set `http.route` on the active `http` server span, and wrap `loader`/`action`/`middleware` in child spans named from the route pattern. Keep the tracer name in one place (`@n8io/...` package) so the template has a single wrapper.

## Logs

Two ways to get logs into OTel:

1. **Logger instrumentation (the bridge).** The logger package emits through `pino` or `winston`, and `instrumentation-pino`/`-winston` do two things automatically: log sending to the Logs SDK, and log correlation (adds `trace_id`, `span_id`, `trace_flags` to each record). [source: pino README] Application code keeps calling the logger. Pino log sending needs pino 7 or newer. `disableLogSending: true` turns off sending and keeps correlation.
2. **Logs API in app code** (`logs.getLogger(...).emit(...)`). The spec says the Logs API "is provided for logging library authors to build" appenders; direct use is allowed but not the intended path for applications. [source: opentelemetry.io spec, Logs API] Status of the API: Stable. The JS SDK for logs is Stable as of 3.0.0 (above).

Recommendation: option 1. The `logger` package stays the only thing app code touches, and OTel stays an infrastructure detail. To get log records out you also need a log record processor and OTLP exporter configured on the SDK (`OTEL_LOGS_EXPORTER=otlp` with the env-based setup, or `logRecordProcessors` in code). Note `NodeSDK` logs `OTEL_METRICS_EXPORTER is empty. Using default otlp exporter.` at debug level: a default OTLP metrics exporter is created even if you configure only traces. [tested]

The logger choice itself is not settled in the map. If pino, use `instrumentation-pino`. The doc above does not need to change for winston.

## Browser

**The classic browser packages are being replaced.** [source] `opentelemetry-js` CHANGELOG (0.300.0): `instrumentation-fetch` and `instrumentation-xml-http-request` are soft-deprecated in favor of `@opentelemetry/browser-instrumentation`. The `opentelemetry-browser` README lists fetch/XHR as "deprecated" and `instrumentation-document-load` and `-user-interaction` as "experimental" with replacements that **emit events (log records), not spans**. It says not to mix classic and new instrumentations for the same API (every call would be recorded twice).

So for a new template in late 2026, use the new repo:

- `@opentelemetry/browser-sdk` (`startBrowserSdk({ serviceName, exportConfig, instrumentations, ... })`) plus `@opentelemetry/browser-instrumentation` (`FetchInstrumentation` from `.../experimental/fetch`). Both are experimental with breaking changes expected; `browser-instrumentation` went 0.8.2, 0.9.0, 0.10.0 in three weeks.
- The new instrumentations do nothing until `enable()` (or until passed to the Browser SDK). Do not use `registerInstrumentations()` with them.
- Start the SDK before any other code that patches `fetch`.
- It sets the global tracer provider, logger provider, propagator and context manager by default (`setGlobals: true`).
- No metrics in the browser SDK.
- For web vitals, navigation timing and errors, the new package gives events (log records), not spans. A Loki-style logs backend is where they land.

### Browser to backend trace context

[source: `opentelemetry-browser` `packages/instrumentation/src/fetch/instrumentation.ts`] `FetchInstrumentation` injects `traceparent` (W3C, default propagator) into requests **only if the request is same-origin or matches `propagateTraceHeaderCorsUrls`**. In the template's combined mode the API and SSR share one origin, so propagation just works. In frontend-only mode (SPA calling an external API; the map lists this as not yet specified) set `propagateTraceHeaderCorsUrls` and make the API's CORS config allow the `traceparent`, `tracestate` and `baggage` request headers. The backend side needs nothing special: `instrumentation-http` extracts the header. [tested: a parent span's context crossed a fetch into the Hono server and came out as the server span's parent]

Open gap: **the initial page navigation.** [source] The browser sends no trace context for a document request. The classic `instrumentation-document-load` handled this with a server-rendered `<meta name="traceparent">` tag; its replacement (navigation timing) is event-based and I found no equivalent. So the SSR request becomes its own trace, and the browser's page-load telemetry is not linked to it. Later `fetch` calls (including React Router's client-side data requests, if they go through `window.fetch`, which I did not verify) are linked to the browser's own spans. If linking page loads matters, the server can add the current trace ID to a response header or a `<meta>` tag by hand, and a custom browser span can adopt it. That is a design choice for the telemetry conventions ticket (#13).

### Where the browser exports to

The browser must POST OTLP/HTTP to a collector reachable from the user's machine. The dev image's collector config already allows CORS from `http://*` on 4318 (read from `docker-otel-lgtm` `otelcol-config.yaml`), so local dev works with `exportConfig.url = http://localhost:4318`. In production the template has to pick: expose a collector with CORS and some form of auth/rate limiting, or proxy through the app's own backend (an `/otlp` route). Browser telemetry endpoints cannot hold secrets. That decision is outside this ticket and affects #13.

## What I did not verify

- A real Postgres query span (no database available). Only the connect spans and "Drizzle emits none" were tested.
- Redis spans (no Redis available). Relying on README and versions.
- Pino log sending end to end.
- `http.server.request.duration` metric attributes after the late `http.route` set.
- The browser SDK in a real browser, and the SSR plus hydration interaction.
- That `NodeSDK` plus the loader hook survives a production build (the template's Dockerfile, #4).

## Inputs other tickets need

- **Node version (#7):** 22.15 or newer, required by the SDK 3.x line.
- **Postgres driver (#12):** pick `pg` (node-postgres) to get DB spans.
- **Redis client (#12):** `ioredis` or `redis`. Either has an instrumentation.
- **Logger (not yet decided):** pino or winston both have a bridge. Pick pino unless there is a reason not to.
- **Process startup (#4):** the container command needs `--experimental-loader=...hook.mjs --import ./telemetry.js` (or the equivalent for the build tool), and the Hono and React Router entry files must not import instrumented modules before the preload runs. Both modes need it; frontend-only mode has no Node process and only the browser SDK.
- **Telemetry conventions (#13):** span naming, which attributes are allowed (`url.full` can contain query-string secrets; `instrumentation-http` redacts known sensitive query parameters by default), the custom route-naming middleware, and the page-load linking gap.

## Sources

- opentelemetry-js: [CHANGELOG.md](https://github.com/open-telemetry/opentelemetry-js/blob/main/CHANGELOG.md), [experimental/CHANGELOG.md](https://github.com/open-telemetry/opentelemetry-js/blob/main/experimental/CHANGELOG.md), [api/CHANGELOG.md](https://github.com/open-telemetry/opentelemetry-js/blob/main/api/CHANGELOG.md), [doc/esm-support.md](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md), [doc/3.x/migration-guide.md](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/3.x/migration-guide.md), [README feature status](https://github.com/open-telemetry/opentelemetry-js#feature-status), [instrumentation-http README](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-instrumentation-http)
- opentelemetry-js-contrib: READMEs for [instrumentation-pg](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pg), [-ioredis](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-ioredis), [-redis](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-redis), [-undici](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-undici), [-pino](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-pino), [-document-load](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-document-load), [auto-instrumentations-node](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/auto-instrumentations-node)
- opentelemetry-browser: [README](https://github.com/open-telemetry/opentelemetry-browser), [instrumentation README and fetch source](https://github.com/open-telemetry/opentelemetry-browser/tree/main/packages/instrumentation), [sdk README](https://github.com/open-telemetry/opentelemetry-browser/tree/main/packages/sdk)
- opentelemetry.io: [JS status](https://opentelemetry.io/docs/languages/js/), [Node getting started](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/), [Logs API spec](https://opentelemetry.io/docs/specs/otel/logs/api/), [database semconv](https://opentelemetry.io/docs/specs/semconv/database/)
- Hono: [`@hono/otel` README and source](https://github.com/honojs/middleware/tree/main/packages/otel). Hono's own docs have no OTel guide page (`hono.dev/docs/guides/otel` is a 404).
- Drizzle: published `drizzle-orm@0.45.4` and `1.0.0-rc.5` tarballs (`tracing.js`); [source `tracing.ts`](https://github.com/drizzle-team/drizzle-orm/blob/main/drizzle-orm/src/tracing.ts)
- React Router: [instrumentation guide](https://reactrouter.com/how-to/instrumentation), [CHANGELOG](https://github.com/remix-run/react-router/blob/main/packages/react-router/CHANGELOG.md)
- Grafana: [docker-otel-lgtm](https://github.com/grafana/docker-otel-lgtm) README and `docker/otelcol-config.yaml`
