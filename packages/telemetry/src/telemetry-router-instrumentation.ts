import { loggerErrSerialize } from "@n8io/baseline-logger/err-serialize";
import { SpanKind, SpanStatusCode, trace } from "@opentelemetry/api";

// The parts of React Router's ServerInstrumentation this file uses, written out
// so the package needs no react-router peer. React Router passes a thrown
// handler error back in the result instead of throwing it.
type RouterCallResult =
	| { error: undefined; status: "success" }
	| { error: unknown; status: "error" };

type RouterHandlerInstrument = (
	call: () => Promise<RouterCallResult>,
	info: { readonly pattern: string },
) => Promise<void>;

type RouterRequestInstrument = (
	handle: () => Promise<
		RouterCallResult & { meta: { pattern: string } | undefined }
	>,
	info: { readonly request: { readonly method: string } },
) => Promise<void>;

export type TelemetryRouterInstrumentation = {
	handler(handler: {
		instrument(instrumentations: { request?: RouterRequestInstrument }): void;
	}): void;
	route(route: {
		instrument(instrumentations: {
			action?: RouterHandlerInstrument;
			loader?: RouterHandlerInstrument;
		}): void;
	}): void;
};

const tracer = () => trace.getTracer("@n8io/baseline-telemetry");

// A thrown Response (a redirect, a 404) is a normal outcome, not an error.
const handlerSpan =
	(kind: "action" | "loader"): RouterHandlerInstrument =>
	(call, { pattern }) =>
		tracer().startActiveSpan(
			`${kind} ${pattern}`,
			{ attributes: { "http.route": pattern }, kind: SpanKind.INTERNAL },
			async (span) => {
				const { error, status } = await call();
				if (status === "error" && error instanceof Error) {
					const type = loggerErrSerialize(error).type;
					span.setAttribute("error.type", type);
					span.setStatus({ code: SpanStatusCode.ERROR, message: type });
				}
				span.end();
			},
		);

// The React Router `instrumentations` entry for the server build: names the
// HTTP server span after the route pattern and wraps loaders and actions.
export const telemetryRouterInstrumentation: TelemetryRouterInstrumentation = {
	handler(handler) {
		handler.instrument({
			async request(handle, { request }) {
				const span = trace.getActiveSpan();
				const { meta } = await handle();
				if (span !== undefined && meta !== undefined) {
					span.setAttribute("http.route", meta.pattern);
					span.updateName(`${request.method} ${meta.pattern}`);
				}
			},
		});
	},
	route(route) {
		route.instrument({
			action: handlerSpan("action"),
			loader: handlerSpan("loader"),
		});
	},
};
