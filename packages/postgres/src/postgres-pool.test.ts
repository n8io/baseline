import { logger } from "@n8io/baseline-logger";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type PostgresPool, postgresPoolCreate } from "./index.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

// Option checks and defaults: no connection is made, so these run without Docker.
describe("postgresPoolCreate", () => {
	it.each([
		["mysql://user:secret@host/db", '"mysql://"'],
		["memory://", '"memory://"'],
		["user:secret@host/db", '"user://"'],
		["//host/db", "no scheme"],
	])("refuses %s, naming the valid schemes but never the URL", (url, found) => {
		expect(() => postgresPoolCreate({ databaseUrl: url })).toThrow(
			new TypeError(
				`postgresPoolCreate: databaseUrl must start with postgres:// or postgresql://, found ${found}`,
			),
		);
	});

	it("applies the defaults and lets overrides win", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: "postgresql://localhost/db",
		});
		await using pgPoolSmall = postgresPoolCreate({
			databaseUrl: "postgres://localhost/db",
			max: 2,
		});

		expect(pgPool.options).toMatchObject({
			connectionString: "postgresql://localhost/db",
			connectionTimeoutMillis: 3_000,
			keepAlive: true,
			keepAliveInitialDelayMillis: 10_000,
			max: 10,
			query_timeout: 15_000,
		});
		expect(pgPoolSmall.options.max).toBe(2);
	});

	it("passes vendor settings to pg, and its own options win", async () => {
		await using pgPool = postgresPoolCreate({
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
	});

	it.each([
		["connectionString", "databaseUrl"],
		["connectionTimeoutMillis", "connectTimeoutMs"],
		["host", "databaseUrl"],
		["max", "max"],
		["password", "databaseUrl"],
		["query_timeout", "queryTimeoutMs"],
	])("refuses vendor.%s, which %s sets", (key, option) => {
		expect(() =>
			postgresPoolCreate({
				databaseUrl: "postgres://localhost/db",
				vendor: { [key]: 1 },
			}),
		).toThrow(
			new TypeError(
				`postgresPoolCreate: vendor.${key} is not allowed: set it with ${option} instead`,
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
				"postgresPoolCreate: vendor.ssl is not allowed with sslmode in databaseUrl: pg lets the URL win; set TLS in one place",
			),
		);
	});

	it.each(["connectTimeoutMs", "max", "queryTimeoutMs"] as const)(
		"refuses a %s that is not a positive integer",
		(option) => {
			for (const value of [0, -1, 1.5, Number.NaN]) {
				expect(() =>
					postgresPoolCreate({
						databaseUrl: "postgres://localhost/db",
						[option]: value,
					}),
				).toThrow(
					new TypeError(
						`postgresPoolCreate: ${option} must be a positive integer${option === "max" ? "" : ", 2147483647 at most"}${option === "queryTimeoutMs" ? " or null" : ""}, found ${value}`,
					),
				);
			}
		},
	);

	it.each(["connectTimeoutMs", "queryTimeoutMs"] as const)(
		"refuses a %s over 2147483647, the most a timer holds",
		(option) => {
			expect(() =>
				postgresPoolCreate({
					databaseUrl: "postgres://localhost/db",
					[option]: 2_147_483_648,
				}),
			).toThrow(
				new TypeError(
					`postgresPoolCreate: ${option} must be a positive integer, 2147483647 at most${option === "queryTimeoutMs" ? " or null" : ""}, found 2147483648`,
				),
			);
		},
	);

	it("reads null as the default, except queryTimeoutMs, where null turns the limit off", async () => {
		await using pgPool = postgresPoolCreate({
			connectTimeoutMs: null,
			databaseUrl: "postgres://localhost/db",
			max: null,
			queryTimeoutMs: null,
			vendor: null,
		});

		expect(pgPool.options).toMatchObject({
			connectionTimeoutMillis: 3_000,
			keepAlive: true,
			max: 10,
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
});
