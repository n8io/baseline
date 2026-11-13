# @n8io/baseline-telemetry

OpenTelemetry for every process: a preload that starts traces, metrics and logs before the app loads, plus spans and a duration metric for use cases and React Router.

```sh
pnpm add @n8io/baseline-telemetry import-in-the-middle
```

## Exports

- `@n8io/baseline-telemetry/register`: the preload. It instruments HTTP, undici, pg, Redis, pino and the Node runtime, never traces `/livez` or `/readyz`, makes a pg or Redis span only inside a trace (a query in a request, a job or a use case; never a queue poll or boot), and redacts URL query values and drops exception messages before export.
- `telemetryUseCasesTrace(useCases)`: wraps each use case in a span named after it and records `baseline.use_case.duration`. An `err` result sets `error.type` but leaves the status unset; a throw sets status Error.
- `@n8io/baseline-telemetry/span`: `telemetrySpanAttributesSet(attributes)` sets facts about the work (an id, a count) on the active span, so callers need no OpenTelemetry import, and the entry loads only the OpenTelemetry API, not the SDK. `telemetrySpanRun(name, work)` runs `work` in a child span and returns its result; a throw sets status Error and `error.type`, and is rethrown.
- `telemetryRouterInstrumentation`, `TelemetryRouterInstrumentation`: the React Router server `instrumentations` entry. It names the HTTP span after the route pattern and adds a span per loader and action.
- `telemetryShutdown()`: flushes and stops every signal. List it last in the shutdown resources.

## Example

Start each process with one preload file that registers the ESM loader hook in-thread (`module.registerHooks`, so Node 26 prints no DEP0205) and then imports the telemetry preload (without the hook, ESM modules are not patched). The Template's is `src/preload.ts`:

```ts
import { register } from "import-in-the-middle/register-hooks.mjs";

register();
await import("@n8io/baseline-telemetry/register");
```

```sh
node --import ./src/preload.ts src/server.ts
```

```ts
import { telemetryUseCasesTrace } from "@n8io/baseline-telemetry";

const fooUseCases = telemetryUseCasesTrace(
	fooUseCasesCreate(fooPortsCreate(ports)),
);
```

## Needs

- Peer: `@opentelemetry/api`. Add `import-in-the-middle` for the loader hook the preload file registers; it must resolve to the same copy `@opentelemetry/instrumentation` uses, so give it a caret range.
- Env: the standard `OTEL_*` variables, such as `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT`. Every signal, metrics included, exports OTLP over http/protobuf only; another `OTEL_EXPORTER_OTLP_*_PROTOCOL` is ignored with a warning. `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER` take `otlp` (default), `console` or `none`.
