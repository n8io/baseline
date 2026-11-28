import { type Logger, loggerCreate } from "./logger.ts";

/**
 * Returns a getter for one logger, built by `loggerCreate` on the first call, not when this runs:
 * a bad `LOG_LEVEL` throws `loggerCreate`'s TypeError at that call, never at import. Later calls
 * return the same logger. Each getter holds its own logger, so a Package makes one at module level.
 */
export const loggerDefaultCreate = (): (() => Logger) => {
	let logger: Logger | undefined;

	return () => {
		logger ??= loggerCreate();
		return logger;
	};
};
