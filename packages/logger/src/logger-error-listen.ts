// Who hears each error the logger logs at error or fatal: error tracking, without its callers
// changing. A listener runs inside the log call, so it sees the caller's active trace, and must
// return at once and never throw; one that throws is skipped.
export type LoggerErrorListener = (error: unknown) => void;

const listeners = new Set<LoggerErrorListener>();

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
	for (const listener of listeners) {
		try {
			listener(error);
		} catch {
			// A listener's failure must never fail the log call.
		}
	}
};
