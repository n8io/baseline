/** The longest wait a timer takes (2^31 - 1 ms, about 24.8 days); Postgres refuses a longer one too. */
export const sharedTimerMaxMs = 2_147_483_647;

/** A running timer from `sharedTimeTimer`: its promise and the call that stops it. */
export type SharedTimeTimer<V> = {
	/** Stops the timer; `promise` then never settles. Safe to call after it fired. */
	clear: () => void;
	/** Resolves `value` once the full wait has passed. */
	promise: Promise<V>;
};

/**
 * Resolves `value` after `ms`, however long: a wait over `sharedTimerMaxMs` runs as several timers
 * in a row, since one `setTimeout` over the cap fires after about 1 ms. A negative `ms` counts as
 * 0. The timer is `unref`ed so a pending wait never holds a process open, unless `ref` is true.
 * Call `clear()` when the wait is no longer needed.
 */
export const sharedTimeTimer = <V>({
	ms,
	ref,
	value,
}: {
	ms: number;
	ref?: boolean | null;
	value: V;
}): SharedTimeTimer<V> => {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const promise = new Promise<V>((resolve) => {
		const arm = (left: number): void => {
			const step = Math.min(left, sharedTimerMaxMs);
			timer = setTimeout(() => {
				if (left > step) arm(left - step);
				else resolve(value);
			}, step);
			if (ref !== true && typeof timer === "object") timer.unref();
		};
		arm(Math.max(0, ms));
	});
	return { clear: () => clearTimeout(timer), promise };
};

/**
 * Settles like `work`, or resolves `value` once `ms` passes first, however long `ms` is (see
 * `sharedTimeTimer`). The timer is cleared when either wins, and `unref`ed so a pending wait never
 * holds a process open.
 */
export const sharedTimeRace = async <T, V>({
	ms,
	value,
	work,
}: {
	ms: number;
	value: V;
	work: Promise<T>;
}): Promise<T | V> => {
	const timer = sharedTimeTimer({ ms, value });
	try {
		return await Promise.race([work, timer.promise]);
	} finally {
		timer.clear();
	}
};

const timedOut = Symbol("timedOut");
const isTimedOut = (value: unknown): value is typeof timedOut =>
	value === timedOut;

/**
 * Settles like `work`, or rejects with a `DOMException` named `TimeoutError` (carrying `message`)
 * once `ms` passes first. It does not cancel `work`.
 */
export const sharedTimeLimit = async <T>({
	message,
	ms,
	work,
}: {
	message: string;
	ms: number;
	work: Promise<T>;
}): Promise<Awaited<T>> => {
	const result = await sharedTimeRace<T, typeof timedOut>({
		ms,
		value: timedOut,
		work,
	});
	if (isTimedOut(result)) throw new DOMException(message, "TimeoutError");
	return result;
};
