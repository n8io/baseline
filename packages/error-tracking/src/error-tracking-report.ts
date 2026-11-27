import type { LoggerErr } from "@n8io/baseline-logger/err-serialize";
import type { Event, Scope } from "@sentry/core";
import { errorTrackingExceptionsCreate } from "./error-tracking-exceptions.ts";

type SpanContext = { spanId: string; traceId: string };

/** The tags an error's code and constraint become. */
export const errorTrackingReportTagsCreate = (
	err: LoggerErr,
): NonNullable<Event["tags"]> => ({
	...(err.code === undefined ? {} : { "error.code": err.code }),
	...(err.constraint === undefined
		? {}
		: { "error.constraint": err.constraint }),
});

/** The Error report for a serialized error: exceptions innermost cause first, level and tags. */
export const errorTrackingReportEventCreate = (err: LoggerErr): Event => ({
	exception: { values: [...errorTrackingExceptionsCreate(err)] },
	level: "error",
	tags: errorTrackingReportTagsCreate(err),
});

/** Links a scope's next report to the trace it happened in; leaves the scope alone without one. */
export const errorTrackingReportScopeTrace = (
	scope: Scope,
	spanContext: SpanContext | undefined,
): void => {
	if (spanContext === undefined) return;
	scope.setPropagationContext({
		propagationSpanId: spanContext.spanId,
		sampleRand: Math.random(),
		traceId: spanContext.traceId,
	});
	scope.setTag("trace_id", spanContext.traceId);
};
