# @n8io/baseline-error-tracking

Error reports: an unexpected error, with its class name, stack frames, cause chain and trace id, sent to error tracking (Sentry today) for triage. Never its message, which can hold input text, the same rule the logger follows. `ErrorTracking` names no vendor, so moving to another one means a new `errorTracking<Vendor>Create` adapter here and one line in the Project that picks it; callers do not change. `report` returns at once, so a slow or failing Sentry never slows or fails a request; `close()` waits up to 2 s for the reports in flight.

```sh
pnpm add @n8io/baseline-error-tracking
```

## Exports

- `ErrorTracking`: `report(error)` and `close()`. `report` never throws: a report that cannot be sent is dropped. Inside an active span, the report carries its trace id and span id, so it links to its trace.
- `errorTrackingSentryCreate({ dsn, environment, vendor? })`: reports to Sentry through `@sentry/node`'s own `NodeClient`, not `Sentry.init`, so it installs no process handler, module hook or tracer provider: the shutdown handle owns crashes and `@n8io/baseline-telemetry` owns traces. Before sending, it drops every exception value (the message), breadcrumbs, extra, request and user data.
- `ErrorTrackingSentryVendorOptions`: `vendor`, Sentry's own init options (`release`, `serverName`, `sampleRate`, `transport`), outside the contract. It throws on the keys this Package sets or that would send more than an Error report carries: `dsn`, `environment`, `beforeSend`, `integrations`, `defaultIntegrations`, `stackParser`, `dataCollection`, `includeLocalVariables`, `enableOpenTelemetrySetup`, `enableRuntimeChannelInjection`, `tracesSampleRate`, `tracesSampler`.

## Example

Report every error the logger logs at error or fatal, so callers keep calling `logger.error` and nothing else:

```ts
import { errorTrackingSentryCreate } from "@n8io/baseline-error-tracking";
import { loggerErrorListen } from "@n8io/baseline-logger";

const errorTracking = errorTrackingSentryCreate({
	dsn: ENV.SENTRY_DSN,
	environment: ENV.APP_ENV,
});
const stop = loggerErrorListen((error) => errorTracking.report(error));

// At shutdown:
stop();
await errorTracking.close();
```

## Needs

- A Sentry project's DSN. The Template reads it from `SENTRY_DSN`, which is optional: without it, nothing is reported, and errors are still logged.
