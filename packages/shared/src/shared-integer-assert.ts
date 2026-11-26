/**
 * Throws a `TypeError` `<caller>: <name> must be <what>, found <value>` unless `value` is a safe
 * integer from `min` to `max`. `caller` is the public function that was handed the option.
 */
export const sharedIntegerAssert = ({
	caller,
	max,
	min,
	name,
	value,
}: {
	caller: string;
	max?: number | null;
	min: number;
	name: string;
	value: number;
}): void => {
	const upper = max ?? Number.MAX_SAFE_INTEGER;
	if (Number.isSafeInteger(value) && value >= min && value <= upper) return;
	const range =
		max == null
			? `a whole number, ${min} or more`
			: `a whole number from ${min} to ${max}`;
	throw new TypeError(`${caller}: ${name} must be ${range}, found ${value}`);
};
