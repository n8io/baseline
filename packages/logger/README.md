# @n8io/baseline-logger

**One logger that keeps credentials and error messages out**: JSON to stdout, credentials redacted, and an error logged only as its class, code and stack frames, never its message.

```sh
pnpm add @n8io/baseline-logger
```

## Guarantees

| You get                             | How                                                                                                                                                                   |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **One logger everywhere**           | Every Project and Package builds its logger with `loggerCreate`, typed as this Package's own `Logger`, so the library behind it can change without touching a caller. |
| **Credentials never logged**        | Fields named like credentials (`authorization`, `cookie`, `password`, `token` and others) log as `[Redacted]`, also one level down and in headers.                    |
| **No message text**                 | An error leaves only as its class name, `code`, `constraint` and stack frames, down the `cause` chain. With no message given, `msg` is the class name.                |
| **Errors reach error tracking**     | `loggerErrorListen` hears each error logged at error or fatal, inside the log call, so it sees the caller's trace.                                                    |
| **A listener cannot break logging** | A listener that throws is skipped and the line still goes out; an error a listener logs is not heard again.                                                           |
| **Logs join the trace**             | With `@n8io/baseline-telemetry` preloaded, each record also goes out as an OTLP log with the active trace id, and the stdout line gains `trace_id` and `span_id`.     |

## Example

```ts
import { loggerCreate } from "@n8io/baseline-logger";

const logger = loggerCreate();

logger.info({ port }, "Server listening");
logger.error({ err: error }, "Postgres idle client error");
// An err with no message logs its class name as msg, never error.message.
logger.error({ err: error });
```

`loggerCreate({ level })` validates the level when called, so a bad `LOG_LEVEL` stops startup with a `TypeError` that names the valid levels. Nothing throws on importing this Package. Call it once at your entry point, or once per Package in a small module the Package's files import.

Nothing to configure in tests. Assert on what the code returns, not on log lines; a test that must read a line captures stdout for its run and restores it in `onTestFinished`, as the Template's `src/error-tracking-open.test.ts` does.

## Reference

<details><summary><b>Exports</b></summary>

| Export                                                                          | Does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loggerCreateFromConfig(config)`, `LoggerConfig`                                | Returns a new `Logger` from `config.level` alone; it reads no environment, so the level is never taken from `LOG_LEVEL`. A level that is not one throws a `TypeError` naming the valid levels, at the call.                                                                                                                                                                                                                                                                                                                                                      |
| `loggerCreate(options?)`, `LoggerCreateOptions`                                 | Returns a new `Logger`: `fatal`, `error`, `warn`, `info`, `debug`, `trace` and `level`. `options.level` wins, then `LOG_LEVEL` read at the call, then `info`. A level that is not one throws a `TypeError` naming the valid levels, at the call, never at import. There is no default `logger` export. Credential fields are redacted as above.                                                                                                                                                                                                                  |
| `loggerDefaultCreate()`                                                         | Returns a getter for one `Logger`, built by `loggerCreate` on its first call and returned unchanged after. Nothing is read at import, so a bad `LOG_LEVEL` throws its `TypeError` at the first call. Each getter keeps its own logger; a Package makes one at module level: `export const redisLoggerDefault = loggerDefaultCreate();`.                                                                                                                                                                                                                          |
| `Logger`, `LoggerMethod`                                                        | The types of `loggerCreate`'s result and of one level's call, `(fields, message?)` or `(message)`. There is no `child`, no printf-style arguments and no way to set `level`; the level comes from `LOG_LEVEL` or `loggerCreate`'s `level`.                                                                                                                                                                                                                                                                                                                       |
| `loggerErrorListen(listener)`, `LoggerErrorListener`                            | Calls `listener` with each error logged at error or fatal (an `err` field, or an Error passed first), inside the log call, so it sees the caller's active trace; returns a function that stops it. A listener that throws is skipped and the log line still goes out, and an error a listener logs is not heard again. Listeners live on `globalThis`, so two copies of this Package share them. A level that `LOG_LEVEL` turns off reaches no listener, nor does an `err` logged beside a `msg` field. `@n8io/baseline-error-tracking` reports errors this way. |
| `@n8io/baseline-logger/err-serialize`: `loggerErrSerialize(value)`, `LoggerErr` | The safe shape. An error leaves the process only as its class name, `code`, `constraint` and stack, down the `cause` chain (10 deep at most); never its message, which can hold input text. Every logger uses it for every `err`, and telemetry and error tracking build on it.                                                                                                                                                                                                                                                                                  |

</details>

<details><summary><b>Mutation score</b></summary>

`pnpm test:mutation` runs [Stryker](https://stryker-mutator.io) over `src/logger*.ts` (the logger, its options, the error serializer and listeners, and the level check) with the Package's tests and fails below a **floor of 90%**. The score today is 95.98% (187 killed, 4 timed out, 8 survived of 199 mutants). The survivors are equivalent: in `loggerErrSerialize`, an empty message makes `indexOf("")` return 0, which slices the same text as the `-1` branch; in `logger-options`, the `^\w+$` test and the empty-prefix check only choose between dot and bracket path syntax, and no logged record differs between them. Raise the floor as tests allow; never lower it to pass. It is not in CI yet.

</details>

**Needs** `LOG_LEVEL` (`fatal`, `error`, `warn`, `info`, `debug`, `trace` or `silent`; default `info`; read when `loggerCreate` is called, and by `logger` on import, where a bad value falls back to `info`). Runs on [pino](https://getpino.io); nothing in the API names it.
