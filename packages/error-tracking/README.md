# @n8io/baseline-error-tracking

Error reports: an unexpected error, with its class name, stack frames, cause chain and trace id, sent to error tracking (Sentry today) for triage. Never its message, which can hold input text, the same rule the logger follows. `ErrorTracking` names no vendor, so moving to another one means a new `errorTracking<Vendor>Create` adapter here and one line in the Project that picks it; callers do not change. `report` returns at once, so a slow or failing Sentry never slows or fails a request; `close()` waits about 2 s at most for the reports in flight.

```sh
pnpm add @n8io/baseline-error-tracking
```

## Exports

- `ErrorTracking`: `report(error)` and `close()`. `report` never throws: a report that cannot be sent is dropped, and one Sentry refuses is logged at warn. Inside an active span, the report carries its trace id and span id, so it links to its trace.
- `errorTrackingSentryCreate({ dsn, environment, vendor? })`: reports to Sentry's ingestion API with `@sentry/core`'s `ServerRuntimeClient` and `fetch`, with a 5 s timeout per send. It throws on a `dsn` that is not a Sentry DSN, so a mistyped one does not look like a working setup. The report is built from `loggerErrSerialize`, the logger's safe shape, so the error itself never reaches Sentry; `code` and `constraint` become the `error.code` and `error.constraint` tags. An allowlist drops anything else the SDK adds, such as the host name. It installs nothing global: no process handler, module hook or tracer provider.
- `ErrorTrackingSentryVendorOptions`: `vendor`, Sentry's own `release`, `dist` and `sampleRate`, outside the contract. Any other key throws: it would do nothing here, or send more than an Error report carries.

It does not use `@sentry/node`: that one depends on `@sentry/bundler-plugins`, which installs the Sentry CLI (licensed FSL-1.1-Apache-2.0, 22 MB, with a native parser) in every production install, and installs module hooks that `@n8io/baseline-telemetry` already owns. `@sentry/core` is MIT, Sentry's own, and is what `@sentry/node` is built on.

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
- `LOG_LEVEL` at `error` or below, when reports come through `loggerErrorListen`: a level the logger turns off reaches no listener.
