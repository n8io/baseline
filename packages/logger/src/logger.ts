import { pino } from "pino";
import { loggerLevelAssert } from "./logger-level-assert.ts";
import { loggerOptionsCreate } from "./logger-options.ts";

/**
 * One level's call: fields then a message, a caught value alone, or a message alone. An `err`
 * field, or an Error passed first, is logged in the safe shape of loggerErrSerialize.
 */
export type LoggerMethod = {
	(fields: unknown, message?: string): void;
	(message: string): void;
};

/**
 * What every Project and Package may call. The library behind it can change without touching a
 * caller.
 */
export type Logger = {
	readonly level: string;
	fatal: LoggerMethod;
	error: LoggerMethod;
	warn: LoggerMethod;
	info: LoggerMethod;
	debug: LoggerMethod;
	trace: LoggerMethod;
};

/** The one logger: JSON to stdout, level from `LOG_LEVEL` (default `info`). A
 * `LOG_LEVEL` that is not a level throws a `TypeError` on import. */
export const logger: Logger = pino(
	loggerOptionsCreate(loggerLevelAssert(process.env.LOG_LEVEL || "info")),
);
