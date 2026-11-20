import { loggerErrSerialize } from "@n8io/baseline-logger/err-serialize";
import { type Span, SpanStatusCode } from "@opentelemetry/api";

/**
 * Marks `span` failed by a thrown `error`: status Error and `error.type`, both the class name,
 * never the message. Returns the type, for a metric that records it too.
 */
export const telemetrySpanErrorSet = (span: Span, error: unknown): string => {
	const type = loggerErrSerialize(error).type;
	span.setAttribute("error.type", type);
	span.setStatus({ code: SpanStatusCode.ERROR, message: type });
	return type;
};
