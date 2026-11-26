import { loggerCreate } from "@n8io/baseline-logger";

/** The Package's one logger, built from `LOG_LEVEL` when the Package loads: a bad value stops startup with `loggerCreate`'s TypeError. */
export const queueLoggerDefault = loggerCreate();
