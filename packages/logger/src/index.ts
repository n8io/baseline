import { type Logger, pino } from "pino";
import { loggerOptions } from "./logger-options.ts";

export type { LoggerErr } from "./logger-err-serialize.ts";
export { loggerErrSerialize } from "./logger-err-serialize.ts";
export { loggerRedactPaths } from "./logger-options.ts";

// The fixed fields shared packages log, beside msg (spec 4.2).
export type LoggerFields = {
	code?: number | string;
	durationMs?: number;
	err?: unknown;
	route?: string;
	status?: number;
};

// The one logger: JSON to stdout, level from LOG_LEVEL (default info).
export const logger: Logger = pino(
	loggerOptions(process.env.LOG_LEVEL || "info"),
);
