import { describe, expect, it } from "vitest";
import { postgresDatabaseCreate, postgresPoolCreate } from "./index.ts";

// No connection is made: a pool dials on first use.
describe("postgresDatabaseCreate", () => {
	it("wraps a pool from postgresPoolCreate", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: "postgres://localhost/db",
		});

		const db = postgresDatabaseCreate(pgPool);

		expect(typeof db.select).toBe("function");
	});

	it("refuses a client this Package did not create", async () => {
		const pgClient = { query: async () => ({ rowCount: 0, rows: [] }) };

		expect(() => postgresDatabaseCreate(pgClient)).toThrow(
			new TypeError(
				"postgresDatabaseCreate: pgClient must come from postgresPoolCreate or postgresTransactionRun",
			),
		);
	});
});
