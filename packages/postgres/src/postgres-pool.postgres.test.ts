import { describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { postgresPoolCreate } from "./index.ts";

describe("postgresPoolCreate", () => {
	it("rejects a query longer than queryTimeoutMs and still serves the next one", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
			max: 1,
			queryTimeoutMs: 200,
		});

		await expect(pgPool.query("SELECT pg_sleep(5)")).rejects.toThrow(
			"Query read timeout",
		);
		const started = Date.now();
		const { rows } = await pgPool.query<{ one: number }>("SELECT 1 AS one");

		expect(rows).toEqual([{ one: 1 }]);
		expect(Date.now() - started).toBeLessThan(2_000);
	});

	it("connects to Postgres 18", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});

		const { rows } = await pgPool.query<{ server_version_num: string }>(
			"SHOW server_version_num",
		);

		expect(Number(rows[0]?.server_version_num)).toBeGreaterThanOrEqual(180_000);
	});
});
