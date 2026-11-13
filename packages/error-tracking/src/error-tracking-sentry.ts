import { logger } from "@n8io/baseline-logger";
import { trace } from "@opentelemetry/api";
import {
	defaultStackParser,
	linkedErrorsIntegration,
	makeNodeTransport,
	NodeClient,
	type NodeOptions,
	nodeContextIntegration,
	Scope,
} from "@sentry/node";
import type { ErrorTracking } from "./error-tracking.ts";

// Bounds close(), so shutdown never waits on Sentry longer than this.
const closeTimeoutMs = 2000;

// The Sentry settings `vendor` may not carry, and why: a named option sets it, or it would send
// what an Error report never carries, or it would compete with @n8io/baseline-telemetry.
const sentryVendorRefusals = {
	beforeSend: "this Package removes message text in its own beforeSend",
	dataCollection: "an Error report carries no request or personal data",
	defaultIntegrations: "this Package picks the integrations",
	dsn: "set it with dsn instead",
	enableOpenTelemetrySetup: "traces go out through @n8io/baseline-telemetry",
	enableRuntimeChannelInjection:
		"@n8io/baseline-telemetry owns module instrumentation",
	environment: "set it with environment instead",
	includeLocalVariables: "local variables can hold input text",
	integrations: "this Package picks the integrations",
	stackParser: "this Package parses stacks",
	tracesSampleRate: "traces go out through @n8io/baseline-telemetry",
	tracesSampler: "traces go out through @n8io/baseline-telemetry",
} as const;

/**
 * Sentry's own settings, named as `@sentry/node`'s init options name them (`release`,
 * `serverName`, `sampleRate`, `transport`). Outside this Package's contract: moving off Sentry
 * deletes it. The keys in the refusal list are refused.
 */
export type ErrorTrackingSentryVendorOptions = Omit<
	NodeOptions,
	keyof typeof sentryVendorRefusals
>;

export type ErrorTrackingSentryOptions = {
	/** The Sentry project's DSN. */
	dsn: string;
	/** Which deployment reported it: `production`, `development`. */
	environment: string;
	/** Settings only Sentry has, such as `release` or `transport`. */
	vendor?: ErrorTrackingSentryVendorOptions;
};

const vendorAssert = (vendor: object): void => {
	for (const [key, reason] of Object.entries(sentryVendorRefusals)) {
		if (key in vendor) {
			throw new TypeError(`vendor.${key} is not allowed: ${reason}`);
		}
	}
};

// Sends each Error report to Sentry through its own NodeClient, not Sentry.init, so it installs no
// process handler, module hook or tracer provider: the shutdown handle owns crashes and telemetry
// owns traces. The Project hands it every error the logger logs (loggerErrorListen).
export const errorTrackingSentryCreate = ({
	dsn,
	environment,
	vendor = {},
}: ErrorTrackingSentryOptions): ErrorTracking => {
	vendorAssert(vendor);
	const client = new NodeClient({
		transport: makeNodeTransport,
		...vendor,
		// What an Error report keeps, and nothing more.
		beforeSend: (event) => {
			for (const exception of event.exception?.values ?? []) {
				delete exception.value;
			}
			delete event.breadcrumbs;
			delete event.extra;
			delete event.message;
			delete event.request;
			delete event.user;
			return event;
		},
		dsn,
		// Its module hooks would rewrite modules telemetry already instruments.
		enableRuntimeChannelInjection: false,
		environment,
		integrations: [linkedErrorsIntegration(), nodeContextIntegration()],
		stackParser: defaultStackParser,
	});
	const scope = new Scope();
	scope.setClient(client);
	client.init();
	return {
		close: async () => {
			const flushed = await client.close(closeTimeoutMs);
			if (!flushed) {
				logger.warn("Error reports still unsent at close");
			}
		},
		report: (error) => {
			try {
				const reportScope = scope.clone();
				// Links the report to the trace it happened in.
				const spanContext = trace.getActiveSpan()?.spanContext();
				if (spanContext !== undefined) {
					reportScope.setContext("trace", {
						span_id: spanContext.spanId,
						trace_id: spanContext.traceId,
					});
					reportScope.setTag("trace_id", spanContext.traceId);
				}
				reportScope.captureException(error);
			} catch (reportError) {
				logger.warn({ err: reportError }, "Dropped an error report");
			}
		},
	};
};
