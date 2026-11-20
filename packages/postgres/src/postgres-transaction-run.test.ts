import { EventEmitter } from "node:events";
import { logger } from "@n8io/baseline-logger";
import { ok } from "@n8io/baseline-result";
import type pg from "pg";
import { describe, expect, it, vi } from "vitest";
import { type PostgresPool, postgresTransactionRun } from "./index.ts";

// A pool whose one client records its queries, for the paths a live server can't force.
const fakePoolCreate = (
	failing: string[] = [],
): { pgClient: pg.PoolClient; pgPool: PostgresPool; queries: string[] } => {
	const queries: string[] = [];
	const pgClient = Object.assign(new EventEmitter(), {
		query: vi.fn(async (text: string) => {
			queries.push(text);
			if (failing.includes(text)) {
				throw new Error(`${text} failed`);
			}
			return { rows: [] };
		}),
		release: vi.fn(),
	}) as unknown as pg.PoolClient;
	const pgPool = { connect: async () => pgClient } as unknown as PostgresPool;
	return { pgClient, pgPool, queries };
};

describe("postgresTransactionRun client handling", () => {
	it("returns a healthy client to the pool", async () => {
		const { pgClient, pgPool, queries } = fakePoolCreate();

		await postgresTransactionRun({ pgPool, work: async () => ok(undefined) });

		expect(queries).toEqual([
			"BEGIN",
			"SET LOCAL transaction_timeout = '5000ms'",
			"COMMIT",
		]);
		expect(pgClient.release).toHaveBeenCalledWith(undefined);
	});

	it("discards a client whose ROLLBACK fails", async () => {
		const { pgClient, pgPool } = fakePoolCreate(["ROLLBACK"]);

		await expect(
			postgresTransactionRun({
				pgPool,
				work: async () => {
					throw new Error("boom");
				},
			}),
		).rejects.toThrow("boom");
		expect(pgClient.release).toHaveBeenCalledWith(true);
	});

	it("discards and logs a client that emitted an error", async () => {
		const loggerError = vi.spyOn(logger, "error").mockReturnValue(undefined);
		const { pgClient, pgPool } = fakePoolCreate();
		const error = new Error("connection reset");

		await postgresTransactionRun({
			pgPool,
			work: async () => {
				pgClient.emit("error", error);
				return ok(undefined);
			},
		});

		expect(loggerError).toHaveBeenCalledWith(
			{ err: error },
			"Postgres transaction client error",
		);
		expect(pgClient.release).toHaveBeenCalledWith(true);
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
				"postgresTransactionRun: timeoutMs must be a positive integer",
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
