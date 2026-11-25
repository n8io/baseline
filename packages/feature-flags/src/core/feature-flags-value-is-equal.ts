/** Whether two flag values are the same by content: primitives, arrays and plain objects. */
export const featureFlagsValueIsEqual = (a: unknown, b: unknown): boolean => {
	if (Object.is(a, b)) {
		return true;
	}
	if (
		typeof a !== "object" ||
		typeof b !== "object" ||
		a === null ||
		b === null
	) {
		return false;
	}
	if (Array.isArray(a) || Array.isArray(b)) {
		return (
			Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((item, index) => featureFlagsValueIsEqual(item, b[index]))
		);
	}
	const keys = Object.keys(a);
	return (
		keys.length === Object.keys(b).length &&
		keys.every(
			(key) =>
				Object.hasOwn(b, key) &&
				featureFlagsValueIsEqual(
					(a as Record<string, unknown>)[key],
					(b as Record<string, unknown>)[key],
				),
		)
	);
};
