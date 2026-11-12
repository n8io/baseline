// True when `error` or any error in its `.cause` chain is a Postgres unique violation (23505) on
// `constraint`. Drizzle wraps driver errors in DrizzleQueryError, so the pg error is a cause.
export const postgresUniqueViolationIs = (
	error: unknown,
	constraint: string,
): boolean => {
	const seen = new Set<unknown>();
	let current: unknown = error;
	while (
		typeof current === "object" &&
		current !== null &&
		!seen.has(current)
	) {
		seen.add(current);
		if (
			"code" in current &&
			current.code === "23505" &&
			"constraint" in current &&
			current.constraint === constraint
		) {
			return true;
		}
		current = "cause" in current ? current.cause : undefined;
	}
	return false;
};
