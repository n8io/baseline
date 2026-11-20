import { type AnyColumn, type SQL, sql } from "drizzle-orm";

/**
 * How the sort column compares: `text` by byte order (`COLLATE "C"`), `date` as an instant,
 * `integer` and `number` as numbers (`integer` takes only a whole number).
 */
export type PostgresKeysetKind = "date" | "integer" | "number" | "text";

/** What `postgresKeysetCreate` takes. */
export type PostgresKeysetOptions = {
	/** The last row of the previous page; none for the first page. */
	after?: { id: string; value: string | number } | null;
	descending: boolean;
	/** The tie-breaker, unique per row. The cursor's id goes through its encoder. */
	idColumn: AnyColumn;
	kind: PostgresKeysetKind;
	sortColumn: AnyColumn;
};

// An instant: ISO 8601 with a time and an offset, as Date#toISOString writes it. Without the
// offset Postgres would read it in the session's time zone.
const isoInstantPattern =
	/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

const isoInstantIs = (value: string): boolean => {
	if (!isoInstantPattern.test(value) || Number.isNaN(Date.parse(value))) {
		return false;
	}
	// Date.parse rolls 2026-02-30 over to March; Postgres refuses it.
	const [year = 0, month = 0, day = 0] = value
		.slice(0, 10)
		.split("-")
		.map(Number);
	return new Date(Date.UTC(year, month - 1, day)).getUTCDate() === day;
};

const int4Range: readonly [number, number] = [-(2 ** 31), 2 ** 31 - 1];
const int2Range: readonly [number, number] = [-(2 ** 15), 2 ** 15 - 1];

// The values an integer column holds, by Drizzle's SQL type; Postgres refuses any other number.
// A serial is an integer with a sequence default, so it holds the same values.
const integerRanges: Record<string, readonly [number, number]> = {
	integer: int4Range,
	serial: int4Range,
	smallint: int2Range,
	smallserial: int2Range,
};

// `integer` is for an int4 column: on any other column a cursor that cursorDecode lets through
// could still fail, so the mismatch throws on every page, the first included.
const integerKindAssert = (sortColumn: AnyColumn): void => {
	const type = sortColumn.getSQLType();
	if (integerRanges[type] !== int4Range) {
		throw new TypeError(
			`An integer keyset needs an integer or serial column, got ${type}`,
		);
	}
};

const afterValueAssert = ({
	kind,
	sortColumn,
	value,
}: {
	kind: PostgresKeysetKind;
	sortColumn: AnyColumn;
	value: string | number;
}): void => {
	const numeric = kind === "integer" || kind === "number";
	const range = numeric ? integerRanges[sortColumn.getSQLType()] : undefined;
	const valid = numeric
		? typeof value === "number" &&
			(range
				? Number.isInteger(value) && value >= range[0] && value <= range[1]
				: Number.isFinite(value))
		: typeof value === "string" && (kind === "text" || isoInstantIs(value));
	if (!valid) {
		throw new TypeError(
			`${kind === "integer" ? "An" : "A"} ${kind} keyset needs ${range ? `an integer from ${range[0]} to ${range[1]}` : kind === "number" ? "a finite number" : kind === "date" ? "an ISO instant such as 2026-01-01T00:00:00.000Z" : "a string"}, got ${JSON.stringify(value)}`,
		);
	}
};

/**
 * Keyset ("seek") paging on (sort, id): the rows after `after` in the order of `orderBy`. The sort
 * column must be NOT NULL (a NULL never compares), and a `date` column must hold no more than
 * milliseconds, the precision of the JS Date a cursor is written from. Decode and check the
 * cursor before calling; a value of the wrong type for `kind`, a number an integer or smallint
 * sort column cannot hold, or kind `integer` on another column type, throws a TypeError.
 * A number is bound untyped so Postgres reads it as the column's own type: a `::numeric` cast
 * would turn an integer column's index condition into a filter over the whole index.
 */
export const postgresKeysetCreate = ({
	after,
	descending,
	idColumn,
	kind,
	sortColumn,
}: PostgresKeysetOptions): { orderBy: SQL[]; where: SQL | undefined } => {
	if (kind === "integer") integerKindAssert(sortColumn);
	const sortBy =
		kind === "text" ? sql`${sortColumn} COLLATE "C"` : sql`${sortColumn}`;
	const direction = descending ? sql`DESC` : sql`ASC`;
	const orderBy = [sql`${sortBy} ${direction}`, sql`${idColumn} ${direction}`];
	if (!after) return { orderBy, where: undefined };
	afterValueAssert({ kind, sortColumn, value: after.value });
	// The sort side's COLLATE "C" decides the comparison; a date compares as an instant.
	const value =
		kind === "date" ? sql`${after.value}::timestamptz` : sql`${after.value}`;
	const where = sql`(${sortBy}, ${idColumn}) ${descending ? sql`<` : sql`>`} (${value}, ${sql.param(after.id, idColumn)})`;
	return { orderBy, where };
};
