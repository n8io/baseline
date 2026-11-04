import { EventEmitter } from "node:events";
import { logger } from "@n8io/baseline-logger";
import { err, ok } from "@n8io/baseline-result";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type pg from "pg";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import { postgresPoolCreate, postgresTransaction } from "./index.ts";

let pgPool: pg.Pool;

const names = async (): Promise<string[]> =>
	(
		await pgPool.query<{ name: string }>("SELECT name FROM foo ORDER BY name")
	).rows.map((row) => row.name);

beforeAll(async () => {
	pgPool = postgresPoolCreate({
		databaseUrl: await postgresTestDatabaseCreate(),
	});
	await pgPool.query("CREATE TABLE foo (name text NOT NULL)");
});

beforeEach(async () => {
	await pgPool.query("TRUNCATE foo");
	vi.restoreAllMocks();
});

afterAll(async () => {
	await pgPool.end();
});

describe("postgresTransaction", () => {
	it("commits on ok, through Drizzle on the guarded client", async () => {
		const result = await postgresTransaction(pgPool, async (pgClient) => {
			const db = drizzle({ client: pgClient });
			await db.execute(sql`INSERT INTO foo (name) VALUES ('one')`);
			return ok("done");
		});

		expect(result).toEqual(ok("done"));
		expect(await names()).toEqual(["one"]);
		expect(pgPool.idleCount).toBe(pgPool.totalCount);
	});

	it("rolls back on err and returns it", async () => {
		const result = await postgresTransaction(pgPool, async (pgClient) => {
			await pgClient.query("INSERT INTO foo (name) VALUES ('one')");
			return err("FooForbidden");
		});

		expect(result).toEqual(err("FooForbidden"));
		expect(await names()).toEqual([]);
	});

	it("rolls back on a throw and rethrows it", async () => {
		const error = new Error("boom");

		await expect(
			postgresTransaction(pgPool, async (pgClient) => {
				await pgClient.query("INSERT INTO foo (name) VALUES ('one')");
				throw error;
			}),
		).rejects.toBe(error);
		expect(await names()).toEqual([]);
		expect(pgPool.idleCount).toBe(pgPool.totalCount);
	});

	it("runs every query on one client in one transaction", async () => {
		await postgresTransaction(pgPool, async (pgClient) => {
			const first = await pgClient.query<{ id: string }>(
				"SELECT txid_current() AS id",
			);
			const second = await pgClient.query<{ id: string }>(
				"SELECT txid_current() AS id",
			);
			expect(second.rows).toEqual(first.rows);
			return ok(undefined);
		});
	});

	it("throws when the client is used after the transaction ended", async () => {
		let leaked: pg.PoolClient | undefined;
		await postgresTransaction(pgPool, async (pgClient) => {
			leaked = pgClient;
			return ok(undefined);
		});

		expect(() =>
			leaked?.query("INSERT INTO foo (name) VALUES ('late')"),
		).toThrow("Postgres client used after its transaction ended");
		expect(await names()).toEqual([]);
	});

	it("closes the client before rolling back a throw, too", async () => {
		let leaked: pg.PoolClient | undefined;
		await postgresTransaction(pgPool, async (pgClient) => {
			leaked = pgClient;
			throw new Error("boom");
		}).catch(() => undefined);

		expect(() => leaked?.query("SELECT 1")).toThrow(
			"Postgres client used after its transaction ended",
		);
	});

	it("sets transaction_timeout to 5 s by default", async () => {
		const result = await postgresTransaction(pgPool, async (pgClient) => {
			const { rows } = await pgClient.query<{ transaction_timeout: string }>(
				"SHOW transaction_timeout",
			);
			return ok(rows[0]?.transaction_timeout);
		});

		expect(result).toEqual(ok("5s"));
	});

	it("ends a transaction that runs past timeoutMs and discards the broken client", async () => {
		vi.spyOn(logger, "error").mockReturnValue(undefined);

		await expect(
			postgresTransaction(
				pgPool,
				async (pgClient) => {
					await pgClient.query("INSERT INTO foo (name) VALUES ('slow')");
					await pgClient.query("SELECT pg_sleep(2)");
					return ok(undefined);
				},
				{ timeoutMs: 200 },
			),
		).rejects.toThrow("transaction timeout");
		expect(await names()).toEqual([]);
		expect(pgPool.idleCount).toBe(pgPool.totalCount);
	});

	it("refuses a timeoutMs that is not a positive integer", async () => {
		await expect(
			postgresTransaction(pgPool, async () => ok(undefined), { timeoutMs: 0 }),
		).rejects.toThrow(new TypeError("timeoutMs must be a positive integer"));
		await expect(
			postgresTransaction(pgPool, async () => ok(undefined), {
				timeoutMs: 1.5,
			}),
		).rejects.toThrow(TypeError);
	});
});

// A pool whose one client records its queries, for the paths a live server can't force.
const fakePoolCreate = (
	failing: string[] = [],
): { pgClient: pg.PoolClient; pgPool: pg.Pool; queries: string[] } => {
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
	const pgPool = { connect: async () => pgClient } as unknown as pg.Pool;
	return { pgClient, pgPool, queries };
};

describe("postgresTransaction client handling", () => {
	it("returns a healthy client to the pool", async () => {
		const { pgClient, pgPool, queries } = fakePoolCreate();

		await postgresTransaction(pgPool, async () => ok(undefined));

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
			postgresTransaction(pgPool, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		expect(pgClient.release).toHaveBeenCalledWith(true);
	});

	it("discards and logs a client that emitted an error", async () => {
		const loggerError = vi.spyOn(logger, "error").mockReturnValue(undefined);
		const { pgClient, pgPool } = fakePoolCreate();
		const error = new Error("connection reset");

		await postgresTransaction(pgPool, async () => {
			pgClient.emit("error", error);
			return ok(undefined);
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

		await postgresTransaction(pgPool, async (pgClient) => {
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
		});

		expect(lateError).toEqual(
			new Error(
				"Postgres client used after its transaction ended; keep every query inside the callback",
			),
		);
		expect(queries).not.toContain("SELECT 'late'");
	});
});
