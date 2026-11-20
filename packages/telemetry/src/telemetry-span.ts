import { trace } from "@opentelemetry/api";
import { telemetryScope } from "./telemetry-scope.ts";
import { telemetrySpanErrorSet } from "./telemetry-span-error.ts";

/** Facts about the work on a span: an id, a count, which branch ran. */
export type TelemetryAttributes = Record<string, boolean | number | string>;

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
	trace.getTracer(telemetryScope).startActiveSpan(name, async (span) => {
		try {
			return await work();
		} catch (error) {
			telemetrySpanErrorSet(span, error);
			throw error;
		} finally {
			span.end();
		}
	});
