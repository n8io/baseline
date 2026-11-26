import { EventEmitter } from "node:events";
import { ok } from "@n8io/baseline-result";
import type pg from "pg";
import { describe, expect, it } from "vitest";
import { type PostgresPool, postgresTransactionRun } from "./index.ts";
import { postgresLoggerTestRecord } from "./postgres-logger-test-record.ts";

// A pool whose one client records its queries, for the paths a live server can't force.
const fakePoolCreate = (
	failing: string[] = [],
): {
	pgClient: pg.PoolClient;
	pgPool: PostgresPool;
	queries: string[];
	releases: unknown[];
} => {
	const queries: string[] = [];
	const releases: unknown[] = [];
	const pgClient = Object.assign(new EventEmitter(), {
		query: async (text: string) => {
			queries.push(text);
			if (failing.includes(text)) {
				throw new Error(`${text} failed`);
			}
			return { rows: [] };
		},
		release: (discard?: unknown) => {
			releases.push(discard);
		},
	}) as unknown as pg.PoolClient;
	const pgPool = { connect: async () => pgClient } as unknown as PostgresPool;
	return { pgClient, pgPool, queries, releases };
};

describe("postgresTransactionRun client handling", () => {
	it("returns a healthy client to the pool", async () => {
		const { pgPool, queries, releases } = fakePoolCreate();

		await postgresTransactionRun({ pgPool, work: async () => ok(undefined) });

		expect(queries).toEqual([
			"BEGIN",
			"SET LOCAL transaction_timeout = '5000ms'",
			"COMMIT",
		]);
		expect(releases).toEqual([undefined]);
	});

	it("discards a client whose ROLLBACK fails", async () => {
		const { pgPool, releases } = fakePoolCreate(["ROLLBACK"]);

		await expect(
			postgresTransactionRun({
				pgPool,
				work: async () => {
					throw new Error("boom");
				},
			}),
		).rejects.toThrow("boom");
		expect(releases).toEqual([true]);
	});

	it("discards and logs a client that emitted an error", async () => {
		using loggerError = postgresLoggerTestRecord("error");
		const { pgClient, pgPool, releases } = fakePoolCreate();
		const error = new Error("connection reset");

		await postgresTransactionRun({
			pgPool,
			work: async () => {
				pgClient.emit("error", error);
				return ok(undefined);
			},
		});

		expect(loggerError.calls).toEqual([
			[{ err: error }, "Postgres transaction client error"],
		]);
		expect(releases).toEqual([true]);
		expect(pgClient.listenerCount("error")).toBe(0);
	});

	it("closes the client as soon as the callback returns, before COMMIT", async () => {
		const { pgPool, queries } = fakePoolCreate();
		let leaked: pg.PoolClient | undefined;
		let lateError: unknown;

		await postgresTransactionRun({
			pgPool,
			work: async (pgClient) => {
				leaked = pgClient;
				// Read once the callback has returned and before COMMIT is sent.
				return {
					get ok(): true {
						try {
							void leaked?.query("SELECT 'late'");
						} catch (error) {
							lateError = error;
						}
						return true;
					},
					value: undefined,
				};
			},
		});

		expect(lateError).toEqual(
			new Error(
				"Postgres client used after its transaction ended; keep every query inside the callback",
			),
		);
		expect(queries).not.toContain("SELECT 'late'");
	});

	it("refuses a timeoutMs that is not a positive integer", async () => {
		await expect(
			postgresTransactionRun({
				pgPool: fakePoolCreate().pgPool,
				work: async () => ok(undefined),
				timeoutMs: 0,
			}),
		).rejects.toThrow(
			new TypeError(
				"postgresTransactionRun: timeoutMs must be a whole number from 1 to 2147483647, found 0",
			),
		);
		await expect(
			postgresTransactionRun({
				pgPool: fakePoolCreate().pgPool,
				work: async () => ok(undefined),
				timeoutMs: 2_147_483_648,
			}),
		).rejects.toThrow(
			new TypeError(
				"postgresTransactionRun: timeoutMs must be a whole number from 1 to 2147483647, found 2147483648",
			),
		);
		await expect(
			postgresTransactionRun({
				pgPool: fakePoolCreate().pgPool,
				work: async () => ok(undefined),
				timeoutMs: 1.5,
			}),
		).rejects.toThrow(TypeError);
	});
});
