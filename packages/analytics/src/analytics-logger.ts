import { logger } from "@n8io/baseline-logger";
import type { Analytics } from "./analytics.ts";

// Logs each event at debug instead of sending it: development and tests, with no token.
export const analyticsLoggerCreate = (): Analytics => ({
	close: async () => {},
	track: ({ name, properties }) => {
		logger.debug({ event: name, properties }, "Analytics event");
	},
});
