# Tracing and spans

Read when adding a log line, a span, a span attribute or a metric.

## Tracing

One client request is one trace, with no app code. The telemetry preload (`src/preload.ts`: every script runs `node --import ./src/preload.ts`, the image sets it in `NODE_OPTIONS`) does all of it:

- **HTTP in and out.** An incoming W3C `traceparent` is continued; without one the request starts a trace. Outbound `fetch` and `node:http` calls send it on.
- **Into the worker.** An Event carries the publishing request's trace: on the pg-boss job row, or in the Pulsar message properties. The Consumer runs in that trace, retries included.
- **Schedules.** Each tick starts its own trace; Events it publishes carry that one on.
- **Logs.** Every `logger` line inside a request, job or Consumer has `trace_id` and `span_id`. Search logs by `trace_id` to see one request across the server and the worker.
- **Back to the caller.** Every problem+json body has `traceId`, the same id. A caller reports it; you search by it.

Never add a request id, correlation id or trace header by hand, and never pass a trace id through a Port or Event payload: the context already travels.

## Spans

Most spans already exist. Instrumentations time inbound and outbound HTTP, Postgres, Redis and jobs. `telemetryUseCasesTrace` gives every Use case a span, and the router instrumentation gives every loader and action one. So the usual answer to "should this be a span?" is an attribute on the active span.

Decide in this order:

1. Is it a fact about the work: an id, a count, which branch ran, a cache hit? Set it on the active span: `trace.getActiveSpan()?.setAttributes({ "baseline.foo.id": input.fooId })`. Use a semantic-convention key when one exists, otherwise `baseline.<domain>.<key>` in snake_case.
2. Does a span already time it? Then it is not a span. That covers a port call, a transaction, a whole Use case, loader or action.
3. Is it a step inside a Use case whose own duration you would ask about in an incident? Start one child span around it. It qualifies only when no instrumentation times it and it routinely takes milliseconds or grows with input size: parsing an upload, rendering a document, hashing, a large in-memory sort or merge, or a whole batch loop.

Never start a span:

- for a Rule, a helper, or anything that takes microseconds;
- per loop iteration or per item. One span covers the loop and an attribute holds the count;
- to mark a moment. Use an attribute. Do not add span events: exceptions are log records;
- for an error. Return an err; the Use case span records `error.type`;
- in an SPI adapter. A call with no span means no instrumentation covers that library, and adding one is a stop-and-ask.

Name a child span `<useCase> <step>`. A name never holds an id or input: those go in attributes.

```ts
const rows = await trace
	.getTracer("foo")
	.startActiveSpan("fooImport parse", async (span) => {
		try {
			const rows = fooImportRowsParse(input.file);
			span.setAttribute("baseline.foo.row_count", rows.length);
			return rows;
		} catch (error) {
			span.setStatus({ code: SpanStatusCode.ERROR });
			throw error;
		} finally {
			span.end();
		}
	});
```
