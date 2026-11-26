import { type Logger, logger } from "@n8io/baseline-logger";
import {
	type LoggerErr,
	loggerErrSerialize,
} from "@n8io/baseline-logger/err-serialize";
import { trace } from "@opentelemetry/api";
import {
	createStackParser,
	createTransport,
	type ErrorEvent,
	type Exception,
	Scope,
} from "@sentry/core";
import {
	nodeStackLineParser,
	ServerRuntimeClient,
	type ServerRuntimeClientOptions,
} from "@sentry/core/server";
import type { ErrorTracking } from "./error-tracking.ts";

// Bounds close(), so shutdown never waits on Sentry much longer than this.
const closeTimeoutMs = 2000;
// Bounds each send, so a stuck request never holds a slot in the send queue.
const sendTimeoutMs = 5000;

/**
 * Sentry's own settings, named as Sentry's SDK options name them. Outside this Package's contract:
 * moving off Sentry deletes it. Any other key throws, since it would do nothing here or send more
 * than an Error report carries.
 */
export type ErrorTrackingSentryVendorOptions = Pick<
	ServerRuntimeClientOptions,
	"dist" | "release" | "sampleRate"
>;

const vendorKeys = new Set(["dist", "release", "sampleRate"]);

/** What `errorTrackingSentryCreate` takes. */
export type ErrorTrackingSentryOptions = {
	/** The Sentry project's DSN. */
	dsn: string;
	/** Which deployment reported it: `production`, `development`. */
	environment: string;
	/** Where it warns: anything with a `warn` method, such as the Package logger. Default the Package logger. */
	logger?: Pick<Logger, "warn"> | null;
	/** Settings only Sentry has: `release`, `dist`, `sampleRate`. */
	vendor?: ErrorTrackingSentryVendorOptions | null;
};

const stackParser = createStackParser(nodeStackLineParser());

// The report is built from loggerErrSerialize's safe shape, the one definition of what may leave
// the process: class names, codes, constraints and stack frames, innermost cause first, as Sentry
// orders them. The error itself never reaches Sentry, so no message can.
const exceptionsCreate = (err: LoggerErr): Exception[] => {
	const exceptions: Exception[] = [];
	for (let at: LoggerErr | undefined = err; at; at = at.cause) {
		exceptions.unshift({
			stacktrace: { frames: stackParser(at.stack ?? "") },
			type: at.type,
		});
	}
	const top = exceptions.at(-1);
	if (top) top.mechanism = { handled: true, type: "generic" };
	return exceptions;
};

// What an Error report carries; beforeSend drops every other field the SDK adds.
const eventKeys = new Set([
	"dist",
	"environment",
	"event_id",
	"exception",
	"level",
	"platform",
	"release",
	"sdk",
	// Never sent as is: the envelope's trace header is built from it.
	"sdkProcessingMetadata",
	"tags",
	"timestamp",
	"type",
]);
const contextKeys = new Set(["runtime", "trace"]);

const keysKeep = <T extends object>(value: T, keys: Set<string>): T =>
	Object.fromEntries(
		Object.entries(value).filter(([key]) => keys.has(key)),
	) as T;

const eventAllowlist = (event: ErrorEvent): ErrorEvent => ({
	...keysKeep(event, eventKeys),
	contexts: keysKeep(event.contexts ?? {}, contextKeys),
});

// @sentry/core's ServerRuntimeClient and plain fetch, not @sentry/node: that one installs a Sentry
// CLI under the FSL licence and module hooks this needs none of. Nothing global is installed: the
// shutdown handle owns crashes and telemetry owns traces.

/**
 * Sends each Error report to Sentry, with a 5 s timeout per send. The Project hands it every error
 * the logger logs (`loggerErrorListen`). Throws a `TypeError` on a `dsn` that is not a Sentry DSN,
 * or a `vendor` key other than `release`, `dist` and `sampleRate`.
 */
export const errorTrackingSentryCreate = ({
	dsn,
	environment,
	logger: loggerGiven,
	vendor,
}: ErrorTrackingSentryOptions): ErrorTracking => {
	const out = loggerGiven ?? logger;
	for (const key of Object.keys(vendor ?? {})) {
		if (!vendorKeys.has(key)) {
			throw new TypeError(
				`errorTrackingSentryCreate: vendor.${key} is not allowed: only ${[...vendorKeys].join(", ")} reach Sentry`,
			);
		}
	}
	const client = new ServerRuntimeClient({
		...(vendor ?? {}),
		beforeSend: eventAllowlist,
		dsn,
		environment,
		integrations: [],
		platform: "node",
		runtime: { name: "node", version: process.version },
		stackParser,
		transport: (options) =>
			createTransport(options, async ({ body }) => {
				const response = await fetch(options.url, {
					// A copy, typed as the ArrayBuffer-backed bytes fetch takes.
					body: typeof body === "string" ? body : body.slice(),
					method: "POST",
					signal: AbortSignal.timeout(sendTimeoutMs),
				});
				await response.body?.cancel();
				if (!response.ok) {
					out.warn(
						{ status: response.status },
						"Sentry refused an error report",
					);
				}
				return {
					headers: {
						"retry-after": response.headers.get("retry-after"),
						"x-sentry-rate-limits": response.headers.get(
							"x-sentry-rate-limits",
						),
					},
					statusCode: response.status,
				};
			}),
	});
	if (client.getDsn() === undefined) {
		throw new TypeError("errorTrackingSentryCreate: dsn is not a Sentry DSN");
	}
	const scope = new Scope();
	scope.setClient(client);
	client.init();
	const close = async (): Promise<void> => {
		const flushed = await client.close(closeTimeoutMs);
		if (!flushed) {
			out.warn("Error reports still unsent at close");
		}
	};
	return {
		close,
		[Symbol.asyncDispose]: close,
		report: (error) => {
			try {
				const err = loggerErrSerialize(error);
				const reportScope = scope.clone();
				// Links the report to the trace it happened in.
				const spanContext = trace.getActiveSpan()?.spanContext();
				if (spanContext !== undefined) {
					reportScope.setPropagationContext({
						propagationSpanId: spanContext.spanId,
						sampleRand: Math.random(),
						traceId: spanContext.traceId,
					});
					reportScope.setTag("trace_id", spanContext.traceId);
				}
				reportScope.captureEvent({
					exception: { values: exceptionsCreate(err) },
					level: "error",
					tags: {
						...(err.code === undefined ? {} : { "error.code": err.code }),
						...(err.constraint === undefined
							? {}
							: { "error.constraint": err.constraint }),
					},
				});
			} catch (reportError) {
				out.warn({ err: reportError }, "Dropped an error report");
			}
		},
	};
};
