import { logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { type PostgresPool, postgresPoolCreate } from "./index.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

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

	it("sets no query timeout when queryTimeoutMs is null", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: "postgres://localhost/db",
			queryTimeoutMs: null,
		});

		expect(pgPool.options.query_timeout).toBeUndefined();
	});

	it("logs idle client errors instead of crashing the process", async () => {
		const loggerError = vi.spyOn(logger, "error").mockReturnValue(undefined);
		await using pgPool = postgresPoolCreate({
			databaseUrl: "postgres://localhost/db",
		});
		const error = new Error("connection reset");

		pgPool.emit("error", error);

		expect(loggerError).toHaveBeenCalledWith(
			{ err: error },
			"Postgres idle client error",
		);
	});

	it("await using ends the pool when its block ends", async () => {
		let ended: PostgresPool;
		{
			await using pgPool = postgresPoolCreate({
				databaseUrl: "postgres://localhost/db",
			});
			ended = pgPool;
		}

		expect(ended.ended).toBe(true);
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
