import { loggerErrSerialize } from "@n8io/baseline-logger";
import { type Attributes, SpanStatusCode } from "@opentelemetry/api";
import type { LogRecordProcessor } from "@opentelemetry/sdk-logs";
import type { SpanProcessor } from "@opentelemetry/sdk-trace";

// Export-time cleanup (spec 4.4, 15): nothing that can hold input text leaves
// the process. Both processors run first, before the exporting processors.

const queryValue = "REDACTED";

// Replaces every value and keeps every key: "a=1&b" becomes "a=REDACTED&b".
export const telemetryQueryRedact = (query: string): string =>
	query
		.split("&")
		.map((pair) => {
			const at = pair.indexOf("=");
			return at === -1 ? pair : `${pair.slice(0, at)}=${queryValue}`;
		})
		.join("&");

const urlFullRedact = (url: string): string => {
	const start = url.indexOf("?");
	if (start === -1) {
		return url;
	}
	const hash = url.indexOf("#", start);
	const end = hash === -1 ? url.length : hash;
	return `${url.slice(0, start + 1)}${telemetryQueryRedact(url.slice(start + 1, end))}${url.slice(end)}`;
};

// Keeps only the stack frames, cut the same way the logger cuts them, so a
// message spanning several lines cannot leave a line behind.
const stackFramesOnly = (stack: string, message: unknown): string => {
	const error = new Error(typeof message === "string" ? message : "");
	error.stack = stack;
	return loggerErrSerialize(error).stack ?? "";
};

// exception.* attributes keep type and stack frames; the message is dropped.
const exceptionClean = (attributes: Attributes): void => {
	const stack = attributes["exception.stacktrace"];
	if (typeof stack === "string") {
		attributes["exception.stacktrace"] = stackFramesOnly(
			stack,
			attributes["exception.message"],
		);
	}
	delete attributes["exception.message"];
};

export const telemetrySpanCleanup = (): SpanProcessor => ({
	forceFlush: () => Promise.resolve(),
	onEnd: () => undefined,
	// onEnding runs before the span is read-only, so it can still be changed.
	onEnding(span) {
		const { attributes, events, status } = span;
		if (status.code === SpanStatusCode.ERROR && status.message !== undefined) {
			const type = attributes["error.type"];
			span.setStatus({
				code: SpanStatusCode.ERROR,
				message: typeof type === "string" ? type : "Error",
			});
		}
		const query = attributes["url.query"];
		if (typeof query === "string") {
			span.setAttribute("url.query", telemetryQueryRedact(query));
		}
		const full = attributes["url.full"];
		if (typeof full === "string") {
			span.setAttribute("url.full", urlFullRedact(full));
		}
		for (const event of events) {
			if (event.name === "exception" && event.attributes !== undefined) {
				exceptionClean(event.attributes);
			}
		}
	},
	onStart: () => undefined,
	shutdown: () => Promise.resolve(),
});

export const telemetryLogRecordCleanup = (): LogRecordProcessor => ({
	forceFlush: () => Promise.resolve(),
	onEmit(record) {
		const { attributes } = record;
		const message = attributes["exception.message"];
		if (message !== undefined && record.body === message) {
			const type = attributes["exception.type"];
			record.setBody(typeof type === "string" ? type : "Error");
		}
		exceptionClean(attributes);
	},
	shutdown: () => Promise.resolve(),
});
