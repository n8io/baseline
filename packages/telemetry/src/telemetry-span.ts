import { loggerErrSerialize } from "@n8io/baseline-logger/err-serialize";
import { SpanStatusCode, trace } from "@opentelemetry/api";

/** Facts about the work on a span: an id, a count, which branch ran. */
export type TelemetryAttributes = Record<string, boolean | number | string>;

const scope = "@n8io/baseline-telemetry";

/** Sets attributes on the span that is active now. Does nothing when none is. */
export const telemetrySpanAttributesSet = (
	attributes: TelemetryAttributes,
): void => {
	trace.getActiveSpan()?.setAttributes(attributes);
};

/**
 * Runs `work` in a child span named `name` and returns what it returns. Attributes set inside
 * `work` land on this span. A throw sets status Error and `error.type`, and is rethrown.
 */
export const telemetrySpanRun = <T>(
	name: string,
	work: () => Promise<T> | T,
): Promise<T> =>
	trace.getTracer(scope).startActiveSpan(name, async (span) => {
		try {
			return await work();
		} catch (error) {
			const type = loggerErrSerialize(error).type;
			span.setAttribute("error.type", type);
			span.setStatus({ code: SpanStatusCode.ERROR, message: type });
			throw error;
		} finally {
			span.end();
		}
	});
