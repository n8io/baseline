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

/** What `createLogger` takes: every option explicit, so the factory reads no environment. */
export type LoggerConfig = {
	/** One of fatal, error, warn, info, debug, trace or silent. */
	level: string;
};

/** What `loggerCreate` takes. */
export type LoggerCreateOptions = {
	/** One of fatal, error, warn, info, debug, trace or silent. Defaults to `LOG_LEVEL`, then `info`. */
	level?: string | null;
};

/**
 * Creates a logger from `config` alone: JSON to stdout, credentials redacted. It reads no
 * environment. A level that is not one throws a `TypeError` naming the valid levels, at the call.
 */
export const createLogger = (config: LoggerConfig): Logger =>
	pino(loggerOptionsCreate(loggerLevelAssert(config.level)));

/**
 * Creates a logger: JSON to stdout, credentials redacted. The level is `options.level`, else
 * `LOG_LEVEL` read now, else `info`. A level that is not one throws a `TypeError` naming the valid
 * levels, at the call.
 */
export const loggerCreate = (options: LoggerCreateOptions = {}): Logger =>
	createLogger({
		level: options.level || process.env["LOG_LEVEL"] || "info",
	});
