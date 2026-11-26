/** How long `ready` waits for the flag service before it settles `timeout`, when none is given. */
const readyTimeoutMsDefault = 2000;

// The longest delay a timer takes: a larger one fires at once.
const timeoutMsMax = 2_147_483_647;

/** Throws a `TypeError` unless `value` is a non-empty string. */
export const featureFlagsOptionsStringRequire = ({
	name,
	value,
}: {
	name: string;
	value: unknown;
}): void => {
	if (typeof value !== "string" || value.trim() === "") {
		throw new TypeError(`${name} must be a non-empty string`);
	}
};

/**
 * `readyTimeoutMs` as the wait to use: the default when it is left out, else a whole number of
 * milliseconds from 1 up. Throws a `TypeError` on anything else, since NaN or a huge value would
 * fire the timer at once.
 */
export const featureFlagsOptionsTimeoutMsResolve = (
	readyTimeoutMs: number | null | undefined,
): number => {
	if (readyTimeoutMs == null) {
		return readyTimeoutMsDefault;
	}
	if (
		!Number.isInteger(readyTimeoutMs) ||
		readyTimeoutMs < 1 ||
		readyTimeoutMs > timeoutMsMax
	) {
		throw new TypeError(
			`readyTimeoutMs must be a whole number of milliseconds from 1 to ${timeoutMsMax}`,
		);
	}
	return readyTimeoutMs;
};

/** A name for one instance's own OpenFeature domain, so instances never share a context. */
export const featureFlagsOptionsDomainCreate = (): string =>
	`feature-flags-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
