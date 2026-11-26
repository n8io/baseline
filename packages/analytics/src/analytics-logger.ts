import { type LoggerMethod, logger } from "@n8io/baseline-logger";
import type { Analytics } from "./analytics.ts";

/** What `analyticsLoggerCreate` takes. */
export type AnalyticsLoggerOptions = {
	/**
	 * Where each event is logged, at debug: anything with a `debug` method, such as the Package
	 * logger. Default the Package logger (`@n8io/baseline-logger`); `null` means the default.
	 */
	logger?: { debug: LoggerMethod } | null;
};

/**
 * Logs each event at debug instead of sending it: development and tests, with no token. The
 * Package's stand-in when no vendor is set up. `options.logger` replaces the Package logger.
 */
export const analyticsLoggerCreate = (
	options: AnalyticsLoggerOptions = {},
): Analytics => {
	const out = options.logger ?? logger;
	return {
		close: async () => {},
		[Symbol.asyncDispose]: async () => {},
		track: ({ name, properties }) => {
			out.debug(
				properties == null ? { event: name } : { event: name, properties },
				"Analytics event",
			);
		},
	};
};
