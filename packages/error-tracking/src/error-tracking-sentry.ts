import type { Logger } from "@n8io/baseline-logger";
import { loggerErrSerialize } from "@n8io/baseline-logger/err-serialize";
import { trace } from "@opentelemetry/api";
import { createTransport, Scope } from "@sentry/core";
import {
	ServerRuntimeClient,
	type ServerRuntimeClientOptions,
} from "@sentry/core/server";
import type { ErrorTracking } from "./error-tracking.ts";
import { errorTrackingAllowlist } from "./error-tracking-allowlist.ts";
import { errorTrackingStackParser } from "./error-tracking-exceptions.ts";
import { errorTrackingLoggerDefault as logger } from "./error-tracking-logger-default.ts";
import {
	errorTrackingReportEventCreate,
	errorTrackingReportScopeTrace,
} from "./error-tracking-report.ts";
import { errorTrackingSend } from "./error-tracking-send.ts";
import {
	errorTrackingVendorKeyRefused,
	errorTrackingVendorKeys,
} from "./error-tracking-vendor-keys.ts";

// Bounds close(), so shutdown never waits on Sentry much longer than this.
const closeTimeoutMs = 2000;

/**
 * Sentry's own settings, named as Sentry's SDK options name them. Outside this Package's contract:
 * moving off Sentry deletes it. Any other key throws, since it would do nothing here or send more
 * than an Error report carries. Not exported from the Package: write the object inline in
 * `src/error-tracking-open.ts`, where `errorTrackingSentryCreate` takes it.
 */
type ErrorTrackingSentryVendorOptions = Pick<
	ServerRuntimeClientOptions,
	"dist" | "release" | "sampleRate"
>;

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
	const out = loggerGiven ?? logger();
	const refused = errorTrackingVendorKeyRefused(vendor);
	if (refused !== undefined) {
		throw new TypeError(
			`errorTrackingSentryCreate: vendor.${refused} is not allowed: only ${errorTrackingVendorKeys.join(", ")} reach Sentry`,
		);
	}
	const client = new ServerRuntimeClient({
		...(vendor ?? {}),
		beforeSend: errorTrackingAllowlist,
		dsn,
		environment,
		integrations: [],
		platform: "node",
		runtime: { name: "node", version: process.version },
		stackParser: errorTrackingStackParser,
		transport: (options) =>
			createTransport(options, ({ body }) =>
				errorTrackingSend({ body, logger: out, url: options.url }),
			),
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
				errorTrackingReportScopeTrace(
					reportScope,
					trace.getActiveSpan()?.spanContext(),
				);
				reportScope.captureEvent(errorTrackingReportEventCreate(err));
			} catch (reportError) {
				out.warn({ err: reportError }, "Dropped an error report");
			}
		},
	};
};
