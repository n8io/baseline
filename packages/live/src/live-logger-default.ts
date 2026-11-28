import { type Logger, loggerDefaultCreate } from "@n8io/baseline-logger";

/** The Package's one logger: built from `LOG_LEVEL` on the first call, not at import. */
export const liveLoggerDefault: () => Logger = loggerDefaultCreate();
