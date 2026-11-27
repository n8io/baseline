import type { Logger } from "@n8io/baseline-logger";
import { redisLoggerDefault as logger } from "./redis-logger-default.ts";

/** One recorded logger call: the fields or message, then the message when fields came first. */
export type LoggerTestCall = [fields: unknown, message?: string];

/**
 * Swaps one method of the shared logger for a recorder, so a test can assert what was logged and
 * keep the output quiet. Declare it with `using`: the real method returns when the block ends.
 */
export const redisLoggerTestRecord = (
	method: "debug" | "error" | "fatal" | "info" | "warn",
): { calls: readonly LoggerTestCall[]; [Symbol.dispose]: () => void } => {
	const calls: LoggerTestCall[] = [];
	const original = logger[method];
	logger[method] = ((...args: LoggerTestCall) => {
		calls.push(args);
	}) as Logger[typeof method];
	return {
		calls,
		[Symbol.dispose]: () => {
			logger[method] = original;
		},
	};
};
