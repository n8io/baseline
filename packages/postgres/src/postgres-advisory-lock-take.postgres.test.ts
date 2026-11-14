import { ok } from "@n8io/baseline-result";
import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { postgresTestDatabaseCreate } from "../../../test/postgres/postgres-test-database.ts";
import {
	type PostgresPool,
	postgresAdvisoryLockTake,
	postgresPoolCreate,
	postgresTransactionRun,
} from "./index.ts";
import { postgresTestInterleave } from "./testing.ts";

const lockedRun = ({
	key,
	pause,
	pgPool,
}: {
	key: string;
	pause?: () => Promise<void>;
	pgPool: PostgresPool;
}) =>
	postgresTransactionRun({
		pgPool,
		work: async (pgClient) => {
			await postgresAdvisoryLockTake(drizzle({ client: pgClient }), key);
			await pause?.();
			return ok(key);
		},
	});

describe("postgresAdvisoryLockTake", () => {
	it("makes a second transaction on the same key wait until the first ends", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});

		const result = await postgresTestInterleave({
			first: (pause) => lockedRun({ key: "league:1", pause, pgPool }),
			pgPool,
			second: () => lockedRun({ key: "league:1", pgPool }),
		});

		expect(result.secondWaited).toBe(true);
	});

	it("lets a transaction on another key run", async () => {
		await using pgPool = postgresPoolCreate({
			databaseUrl: await postgresTestDatabaseCreate(),
		});

		const result = await postgresTestInterleave({
			first: (pause) => lockedRun({ key: "league:1", pause, pgPool }),
			pgPool,
			second: () => lockedRun({ key: "league:2", pgPool }),
		});

		expect(result).toEqual({
			first: ok("league:1"),
			second: ok("league:2"),
			secondWaited: false,
		});
	});
});
