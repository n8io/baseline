// Who hears each error the logger logs at error or fatal: error tracking, without its callers
// changing. A listener runs inside the log call, so it sees the caller's active trace, and must
// return at once and never throw; one that throws is skipped.
export type LoggerErrorListener = (error: unknown) => void;

// Kept on globalThis, so a Project that ends up with two copies of this Package (one Package on an
// older major) still hears the errors logged through either.
const listenersKey = Symbol.for("@n8io/baseline-logger.errorListeners");
const registry = globalThis as { [listenersKey]?: Set<LoggerErrorListener> };
registry[listenersKey] ??= new Set();
const listeners = registry[listenersKey];

// True while listeners run, so an error a listener logs is not heard again in a loop.
let emitting = false;

/** Calls `listener` with every error logged at error or fatal; the returned function stops it. */
export const loggerErrorListen = (
	listener: LoggerErrorListener,
): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

export const loggerErrorEmit = (error: unknown): void => {
	if (emitting) return;
	emitting = true;
	try {
		for (const listener of listeners) {
			try {
				listener(error);
			} catch {
				// A listener's failure must never fail the log call.
			}
		}
	} finally {
		emitting = false;
	}
};
