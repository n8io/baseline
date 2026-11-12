import { type Logger, pino } from "pino";
import { loggerOptionsCreate } from "./logger-options.ts";

// The one logger: JSON to stdout, level from LOG_LEVEL (default info).
export const logger: Logger = pino(
	loggerOptionsCreate(process.env.LOG_LEVEL || "info"),
);
