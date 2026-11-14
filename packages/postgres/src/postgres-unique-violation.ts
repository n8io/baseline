export type PostgresUniqueViolation = {
	/** The key's columns, or expressions for an expression index. Empty when Postgres sent no detail. */
	columns: string[];
	constraint: string;
	/** The clashing values as Postgres printed them, in column order. Empty when unreadable. */
	values: string[];
};

// The first Postgres unique violation (23505) in `error` or its `.cause` chain. Drizzle wraps
// driver errors in DrizzleQueryError, so the pg error is a cause.
const violationFind = (
	error: unknown,
): { constraint: string; detail: unknown } | undefined => {
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
			typeof current.constraint === "string"
		) {
			return {
				constraint: current.constraint,
				detail: "detail" in current ? current.detail : undefined,
			};
		}
		current = "cause" in current ? current.cause : undefined;
	}
	return undefined;
};

// True when `error` or any error in its `.cause` chain is a unique violation on `constraint`.
export const postgresUniqueViolationIs = (
	error: unknown,
	constraint: string,
): boolean => violationFind(error)?.constraint === constraint;

// Postgres words the detail `Key (a, b)=(1, x) already exists.` and quotes nothing, so a value
// that holds ", " in a key of two or more columns cannot be split: then both lists are empty
// rather than misaligned.
export const postgresUniqueViolationRead = (
	error: unknown,
): PostgresUniqueViolation | undefined => {
	const found = violationFind(error);
	if (!found) return undefined;
	const match =
		typeof found.detail === "string"
			? /^Key \((.*?)\)=\((.*)\) already exists\.$/s.exec(found.detail)
			: null;
	const columns = match?.[1]?.split(", ") ?? [];
	const printed = match?.[2];
	const values =
		printed === undefined
			? []
			: columns.length === 1
				? [printed]
				: printed.split(", ");
	return columns.length === values.length
		? { columns, constraint: found.constraint, values }
		: { columns: [], constraint: found.constraint, values: [] };
};
