/** The longest wait a timer takes (2^31 - 1 ms, about 24.8 days); Postgres refuses a longer one too. */
export const sharedTimerMaxMs = 2_147_483_647;

/**
 * Settles like `work`, or resolves `value` once `ms` passes first. The timer is cleared when
 * either wins, and `unref`ed so a pending wait never holds a process open.
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
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<V>((resolve) => {
		timer = setTimeout(() => resolve(value), Math.max(0, ms));
		if (typeof timer === "object") timer.unref();
	});
	try {
		return await Promise.race([work, timedOut]);
	} finally {
		clearTimeout(timer);
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
