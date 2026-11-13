# @n8io/baseline-logger

The one [pino](https://getpino.io) logger every app and package logs through: JSON to stdout, with credentials redacted and errors reduced to a safe shape.

```sh
pnpm add @n8io/baseline-logger
```

## Exports

- `logger`: the one logger, typed as the package's own `Logger` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` and `level`), so the library behind it can change without touching a caller. Fields named like credentials (`authorization`, `cookie`, `password`, `token` and others) are logged as `[Redacted]`, also one level down and in headers.
- `Logger` and `LoggerMethod`: the types of `logger` and of one level's call, `(fields, message?)` or `(message)`. There is no `child`, no printf-style arguments and no way to set `level`; the level comes from `LOG_LEVEL`.
- `loggerErrorListen(listener)` and `LoggerErrorListener`: calls `listener` with each error logged at error or fatal (an `err` field, or an Error passed first), inside the log call, so it sees the caller's active trace; returns a function that stops it. A listener that throws is skipped and the log line still goes out. A level that `LOG_LEVEL` turns off reaches no listener. `@n8io/baseline-error-tracking` reports errors this way.
- `@n8io/baseline-logger/err-serialize`: `loggerErrSerialize(value)` and `LoggerErr`. An error leaves the process only as its class name, `code`, `constraint` and stack, down the `cause` chain; never its message, which can hold input text. `logger` uses it for every `err`.

## Example

```ts
import { logger } from "@n8io/baseline-logger";

logger.info({ port }, "Server listening");
logger.error({ err: error }, "Postgres idle client error");
// An err with no message logs its class name as msg, never error.message.
logger.error({ err: error });
```

## Needs

- Env: `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`; default `info`).
- With `@n8io/baseline-telemetry` preloaded, each record also goes out as an OTLP log with the active trace id.
