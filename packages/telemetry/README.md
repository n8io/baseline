# @n8io/baseline-telemetry

OpenTelemetry for every process: a preload that starts traces, metrics and logs before the app loads, plus spans and a duration metric for use cases and React Router.

```sh
pnpm add @n8io/baseline-telemetry @opentelemetry/instrumentation
```

## Exports

- `@n8io/baseline-telemetry/register`: the preload. It instruments HTTP, undici, pg, Redis, pino and the Node runtime, never traces `/livez` or `/readyz`, and redacts URL query values and drops exception messages before export.
- `telemetryUseCasesTrace(useCases)`: wraps each use case in a span named after it and records `baseline.use_case.duration`. An `err` result sets `error.type` but leaves the status unset; a throw sets status Error.
- `telemetryRouterInstrumentation`, `TelemetryRouterInstrumentation`: the React Router server `instrumentations` entry. It names the HTTP span after the route pattern and adds a span per loader and action.
- `telemetryShutdown()`: flushes and stops every signal. List it last in the shutdown resources.

## Example

Start each process with the preload and the ESM loader hook (without the hook, ESM modules are not patched):

```sh
node --import @n8io/baseline-telemetry/register \
  --experimental-loader=@opentelemetry/instrumentation/hook.mjs src/server.ts
```

```ts
import { telemetryUseCasesTrace } from "@n8io/baseline-telemetry";

const fooUseCases = telemetryUseCasesTrace(
	fooUseCasesCreate(fooPortsCreate(ports)),
);
```

## Needs

- Peer: `@opentelemetry/api`. Add `@opentelemetry/instrumentation` for the loader hook.
- Env: the standard `OTEL_*` variables, such as `OTEL_SERVICE_NAME` and `OTEL_EXPORTER_OTLP_ENDPOINT`. Every signal, metrics included, exports OTLP over http/protobuf only; another `OTEL_EXPORTER_OTLP_*_PROTOCOL` is ignored with a warning. `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER` and `OTEL_LOGS_EXPORTER` take `otlp` (default), `console` or `none`.
