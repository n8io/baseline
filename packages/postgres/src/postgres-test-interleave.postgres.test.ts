import { ok } from "@n8io/baseline-result";
import { describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type PostgresPool,
	postgresPoolCreate,
	postgresTransactionRun,
} from "./index.ts";
import { postgresTestInterleave } from "./testing.ts";

const counterCreate = async (pgPool: PostgresPool): Promise<void> => {
	await pgPool.query(
		"CREATE TABLE counter (id int PRIMARY KEY, n int NOT NULL)",
	);
	await pgPool.query("INSERT INTO counter VALUES (1, 0)");
};

// Read the count, optionally pause, write it back plus one: a read-modify-write Use case.
const increment = ({
	forUpdate,
	pause,
	pgPool,
}: {
	forUpdate: boolean;
	pause?: () => Promise<void>;
	pgPool: PostgresPool;
}) =>
	postgresTransactionRun({
		pgPool,
		work: async (pgClient) => {
			const { rows } = await pgClient.query<{ n: number }>(
				`SELECT n FROM counter WHERE id = 1${forUpdate ? " FOR UPDATE" : ""}`,
			);
			const n = rows[0]?.n ?? 0;
			await pause?.();
			await pgClient.query("UPDATE counter SET n = $1 WHERE id = 1", [n + 1]);
			return ok(n + 1);
		},
	});

const countRead = async (pgPool: PostgresPool): Promise<number> =>
	(await pgPool.query<{ n: number }>("SELECT n FROM counter WHERE id = 1"))
		.rows[0]?.n ?? -1;

describe("postgresTestInterleave", () => {
	it("shows a lost update when the read takes no row lock", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});
		await counterCreate(pgPool);

		const result = await postgresTestInterleave({
			first: (pause) => increment({ forUpdate: false, pause, pgPool }),
			pgPool,
			second: () => increment({ forUpdate: false, pgPool }),
		});

		expect(result.secondWaited).toBe(false);
		expect(await countRead(pgPool)).toBe(1);
	});

	it("makes the second wait and loses nothing when the read locks the row", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});
		await counterCreate(pgPool);

		const result = await postgresTestInterleave({
			first: (pause) => increment({ forUpdate: true, pause, pgPool }),
			pgPool,
			second: () => increment({ forUpdate: true, pgPool }),
		});

		expect(result).toEqual({
			first: ok(1),
			second: ok(2),
			secondWaited: true,
		});
		expect(await countRead(pgPool)).toBe(2);
	});

	it("fails when first never pauses, and passes first's own error on", async () => {
		const pgPool = { query: async () => ({ rows: [] }) };

		await expect(
			postgresTestInterleave({
				first: async () => "done",
				pgPool,
				second: async () => "never",
			}),
		).rejects.toThrow("first finished without calling pause()");
		await expect(
			postgresTestInterleave({
				first: async () => {
					throw new Error("boom");
				},
				pgPool,
				second: async () => "never",
			}),
		).rejects.toThrow("boom");
	});

	it("fails when second neither waits on a lock nor finishes in time", async () => {
		const pgPool = { query: async () => ({ rows: [] }) };

		await expect(
			postgresTestInterleave({
				first: async (pause) => {
					await pause();
					return "first";
				},
				pgPool,
				second: () => new Promise<never>(() => undefined),
				timeoutMs: 50,
			}),
		).rejects.toThrow(
			"second neither waited on a lock nor finished within 50 ms",
		);
	});

	it("passes second's error on after first resumes", async () => {
		const pgPool = { query: async () => ({ rows: [] }) };
		let firstResumed = false;

		await expect(
			postgresTestInterleave({
				first: async (pause) => {
					await pause();
					firstResumed = true;
				},
				pgPool,
				second: async () => {
					throw new Error("second broke");
				},
			}),
		).rejects.toThrow("second broke");
		expect(firstResumed).toBe(true);
	});

	it("resumes first when second throws before it returns a promise", async () => {
		const pgPool = { query: async () => ({ rows: [] }) };
		let firstResumed = false;

		await expect(
			postgresTestInterleave({
				first: async (pause) => {
					await pause();
					firstResumed = true;
				},
				pgPool,
				second: () => {
					throw new Error("second threw at once");
				},
			}),
		).rejects.toThrow("second threw at once");
		expect(firstResumed).toBe(true);
	});

	it("fails when first calls pause() twice or does not await it", async () => {
		const pgPool = { query: async () => ({ rows: [] }) };

		await expect(
			postgresTestInterleave({
				first: async (pause) => {
					await pause();
					await pause();
				},
				pgPool,
				second: async () => "second",
			}),
		).rejects.toThrow("first called pause() twice");
		await expect(
			postgresTestInterleave({
				first: async (pause) => {
					void pause();
				},
				pgPool,
				second: async () => "second",
			}),
		).rejects.toThrow("first finished before it was resumed; await pause()");
	});

	it("does not count a backend that already waited on a lock", async () => {
		const pgPool = { query: async () => ({ rows: [{ pid: 42 }] }) };

		const result = await postgresTestInterleave({
			first: async (pause) => {
				await pause();
				return "first";
			},
			pgPool,
			second: async () => "second",
		});

		expect(result).toEqual({
			first: "first",
			second: "second",
			secondWaited: false,
		});
	});
});
