import { logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { postgresPoolCreate } from "./index.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

describe("postgresPoolCreate", () => {
	it.each([
		["mysql://user:secret@host/db", '"mysql://"'],
		["memory://", '"memory://"'],
		["user:secret@host/db", '"user://"'],
		["//host/db", "no scheme"],
	])("refuses %s, naming the valid schemes but never the URL", (url, found) => {
		expect(() => postgresPoolCreate({ databaseUrl: url })).toThrow(
			new TypeError(
				`Invalid database URL: found ${found}; use postgres:// or postgresql://`,
			),
		);
	});

	it("applies the defaults and lets overrides win", async () => {
		const pgPool = postgresPoolCreate({
			databaseUrl: "postgresql://localhost/db",
		});
		const pgPoolSmall = postgresPoolCreate({
			databaseUrl: "postgres://localhost/db",
			max: 2,
		});

		expect(pgPool.options).toMatchObject({
			connectionString: "postgresql://localhost/db",
			connectionTimeoutMillis: 3_000,
			keepAlive: true,
			max: 10,
		});
		expect(pgPoolSmall.options.max).toBe(2);
		await Promise.all([pgPool.end(), pgPoolSmall.end()]);
	});

	it("passes vendor settings to pg, and its own options win", async () => {
		const pgPool = postgresPoolCreate({
			databaseUrl: "postgres://localhost/db",
			max: 3,
			vendor: { idleTimeoutMillis: 1_000, keepAlive: false },
		});

		expect(pgPool.options).toMatchObject({
			connectionString: "postgres://localhost/db",
			idleTimeoutMillis: 1_000,
			keepAlive: false,
			max: 3,
		});
		await pgPool.end();
	});

	it.each([
		["connectionString", "databaseUrl"],
		["connectionTimeoutMillis", "connectTimeoutMs"],
		["host", "databaseUrl"],
		["max", "max"],
		["password", "databaseUrl"],
	])("refuses vendor.%s, which %s sets", (key, option) => {
		expect(() =>
			postgresPoolCreate({
				databaseUrl: "postgres://localhost/db",
				vendor: { [key]: 1 },
			}),
		).toThrow(
			new TypeError(
				`vendor.${key} is not allowed: set it with ${option} instead`,
			),
		);
	});

	it("refuses vendor.ssl when the URL sets TLS, since pg lets the URL win", () => {
		expect(() =>
			postgresPoolCreate({
				databaseUrl: "postgres://localhost/db?sslmode=require",
				vendor: { ssl: { rejectUnauthorized: true } },
			}),
		).toThrow(
			new TypeError(
				"vendor.ssl is not allowed with sslmode in databaseUrl: pg lets the URL win; set TLS in one place",
			),
		);
	});

	it("logs idle client errors instead of crashing the process", async () => {
		const loggerError = vi.spyOn(logger, "error").mockReturnValue(undefined);
		const pgPool = postgresPoolCreate({
			databaseUrl: "postgres://localhost/db",
		});
		const error = new Error("connection reset");

		pgPool.emit("error", error);

		expect(loggerError).toHaveBeenCalledWith(
			{ err: error },
			"Postgres idle client error",
		);
		await pgPool.end();
	});

	it("connects to Postgres 18", async () => {
		const pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});

		const { rows } = await pgPool.query<{ server_version_num: string }>(
			"SHOW server_version_num",
		);

		expect(Number(rows[0]?.server_version_num)).toBeGreaterThanOrEqual(180_000);
		await pgPool.end();
	});
});
