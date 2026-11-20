import { logger } from "@n8io/baseline-logger";
import type { Analytics } from "./analytics.ts";

/**
 * Logs each event at debug instead of sending it: development and tests, with no token. The
 * Package's stand-in when no vendor is set up.
 */
export const analyticsLoggerCreate = (): Analytics => ({
	close: async () => {},
	[Symbol.asyncDispose]: async () => {},
	track: ({ name, properties }) => {
		logger.debug(
			properties == null ? { event: name } : { event: name, properties },
			"Analytics event",
		);
	},
});
