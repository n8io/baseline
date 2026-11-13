import { pino } from "pino";
import { loggerOptionsCreate } from "./logger-options.ts";

// One level's call: fields then a message, or a message alone. An `err` field, or an Error passed
// first, is logged in the safe shape of loggerErrSerialize.
export type LoggerMethod = {
	(fields: object, message?: string): void;
	(message: string): void;
};

// What every app and package may call. The library behind it can change without touching a caller.
export type Logger = {
	readonly level: string;
	fatal: LoggerMethod;
	error: LoggerMethod;
	warn: LoggerMethod;
	info: LoggerMethod;
	debug: LoggerMethod;
	trace: LoggerMethod;
};

// The one logger: JSON to stdout, level from LOG_LEVEL (default info).
export const logger: Logger = pino(
	loggerOptionsCreate(process.env.LOG_LEVEL || "info"),
);
