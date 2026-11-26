import pg from "pg";
import type { PostgresPool } from "./postgres-pool.ts";

/**
 * The pg pool behind a `PostgresPool`, for a test that asserts on the driver's own state (its
 * options, its idle count). Not exported from the Package: the public type has no driver in it.
 */
export const postgresTestDriverRead = (pgPool: PostgresPool): pg.Pool => {
	if (!(pgPool instanceof pg.Pool)) {
		throw new TypeError(
			"postgresTestDriverRead: not a pool postgresPoolCreate made",
		);
	}
	return pgPool;
};
