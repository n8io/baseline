import { type Logger, loggerCreate } from "@n8io/baseline-logger";

let logger: Logger | undefined;

/**
 * The Package's one logger, built from `LOG_LEVEL` on the first call, not at import: a bad value
 * throws `loggerCreate`'s TypeError there. Later calls return the same logger.
 */
export const redisLoggerDefault = (): Logger => {
	logger ??= loggerCreate();
	return logger;
};
