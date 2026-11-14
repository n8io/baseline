# Tracing and spans

Read when adding a log line, a span, a span attribute or a metric.

## Tracing

One client request is one trace, with no app code. The telemetry preload (`src/preload.ts`: every script runs `node --import ./src/preload.ts`, the image sets it in `NODE_OPTIONS`) does all of it:

- **HTTP in and out.** An incoming W3C `traceparent` is continued; without one the request starts a trace. Outbound `fetch` and `node:http` calls send it on.
- **Into the worker.** An Event carries the publishing request's trace on its pg-boss job row. The Consumer runs in that trace, retries included.
- **Schedules.** Each tick starts its own trace; Events it publishes carry that one on.
- **Logs.** Every `logger` line inside a request, job or Consumer has `trace_id` and `span_id`. Search logs by `trace_id` to see one request across the server and the worker.
- **Back to the caller.** Every problem+json body has `traceId`, the same id. A caller reports it; you search by it.
- **Error reports.** Every `logger.error` or `logger.fatal` with an `err` is also an Error report in Sentry when the Project has `SENTRY_DSN`, tagged with the same `trace_id`. So log only the unexpected there: an err a Use case returns is expected and is not logged at error.

Never add a request id, correlation id or trace header by hand, and never pass a trace id through a Port or Event payload: the context already travels.

## Spans

Most spans already exist. Instrumentations time inbound and outbound HTTP, Postgres, Redis and jobs. A Postgres or Redis call gets a span only inside a trace, so a queue poll or a boot query makes none. `telemetryUseCasesTrace` gives every Use case a span, and the router instrumentation gives every loader and action one. So the usual answer to "should this be a span?" is an attribute on the active span.

Decide in this order:

1. Is it a fact about the work: an id, a count, which branch ran, a cache hit? Set it on the active span: `telemetrySpanAttributesSet({ "baseline.foo.id": input.fooId })` from `@n8io/baseline-telemetry/span`. Use a semantic-convention key when one exists, otherwise `baseline.<domain>.<key>` in snake_case.
2. Does a span already time it? Then it is not a span. That covers a port call, a transaction, a whole Use case, loader or action.
3. Is it a step inside a Use case whose own duration you would ask about in an incident? Start one child span around it. It qualifies only when no instrumentation times it and it routinely takes milliseconds or grows with input size: parsing an upload, rendering a document, hashing, a large in-memory sort or merge, or a whole batch loop.

Never start a span:

- for a Rule, a helper, or anything that takes microseconds;
- per loop iteration or per item. One span covers the loop and an attribute holds the count;
- to mark a moment. Use an attribute. Do not add span events: exceptions are log records;
- for an error. Return an err; the Use case span records `error.type`;
- in an SPI adapter. A call with no span means no instrumentation covers that library, and adding one is a stop-and-ask.

Name a child span `<useCase> <step>`. A name never holds an id or input: those go in attributes.

Attribute keys in a Use case are checked by A16. Only these shapes pass, with `<domain>` the Domain the Use case is in, in snake_case. A fact such as a cache hit becomes a count (`baseline.foo.cache_hit_count`) or goes on the Use case's `err`:

- `baseline.<domain>.id`, its own id.
- `baseline.<domain>.<thing>_id`, another Domain's id or any other id (`baseline.trade.team_id`, `baseline.trade.proposer_team_id`).
- `baseline.<domain>.<thing>_count`, a count (`baseline.foo.row_count`).

Names, emails and other personal data never go on a span.

One Event hop makes these spans. `<queue>` is the Consumer's queue name with `.ordered` added (`bar.foo-deleted.ordered`; the name is `<consumer domain>.<event entity>-<event verb>`):

1. `send <queue>`, one per subscribed Consumer, in the trace of the Use case that published the Event (a request, or the Schedule's tick).
2. `process <queue>`, written by the Worker, and `complete <queue>` or `fail <queue>` when it settles the job. A Worker fetch has no span of its own.
3. The Use case the Consumer calls, named as the Use case (`barFooDeletedHandle`). When one fetch brings several jobs, `process` is in its own trace with links, and each Use case span hangs off its `send`.

Search for `process <queue>` to find the Consumer's run.

```ts
const rows = await telemetrySpanRun("fooImport parse", () => {
	const rows = fooImportRowsParse(input.file);
	telemetrySpanAttributesSet({ "baseline.foo.row_count": rows.length });
	return rows;
});
```

A Domain never imports `@opentelemetry/api`: `telemetrySpanAttributesSet` and `telemetrySpanRun` are the whole surface, and a throw inside `telemetrySpanRun` sets status Error and `error.type`, and is rethrown.
