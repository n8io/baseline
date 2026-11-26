import { type Logger, logger } from "@n8io/baseline-logger";

/** One recorded logger call: the fields or message, then the message when fields came first. */
export type LoggerTestCall = [fields: unknown, message?: string];

/**
 * Swaps one method of the shared logger for a recorder, so a test can assert what was logged and
 * keep the output quiet, or with `callThrough` still log, so the logger's error listeners hear it.
 * Declare it with `using`: the real method returns when the block ends.
 */
export const queueLoggerTestRecord = (
	method: "debug" | "error" | "fatal" | "info" | "warn",
	{ callThrough = false }: { callThrough?: boolean } = {},
): { calls: readonly LoggerTestCall[]; [Symbol.dispose]: () => void } => {
	const calls: readonly LoggerTestCall[] = [];
	const original = logger[method];
	logger[method] = ((...args: LoggerTestCall) => {
		calls.push(args);
		if (callThrough) {
			(original as (...rest: LoggerTestCall) => void)(...args);
		}
	}) as Logger[typeof method];
	return {
		calls,
		[Symbol.dispose]: () => {
			logger[method] = original;
		},
	};
};
