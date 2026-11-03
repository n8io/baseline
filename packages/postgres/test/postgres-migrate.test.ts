import { fileURLToPath } from "node:url";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { postgresMigrate } from "../src/index.ts";
import { postgresMigrateLockKey } from "../src/postgres-migrate.ts";
import { postgresTestDatabaseCreate } from "./postgres-test-database.ts";

const migrationsFolder = fileURLToPath(new URL("migrations", import.meta.url));

// pg_locks splits a bigint advisory key into classid (high 32 bits) and objid (low 32 bits).
const key = BigInt.asUintN(64, BigInt(postgresMigrateLockKey));
const classid = String(key >> 32n);
const objid = String(key & 0xffff_ffffn);

const query = async <R extends pg.QueryResultRow>(
	databaseUrl: string,
	text: string,
): Promise<R[]> => {
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		return (await pgClient.query<R>(text)).rows;
	} finally {
		await pgClient.end();
	}
};

const lockStates = async (databaseUrl: string): Promise<boolean[]> =>
	(
		await query<{ granted: boolean }>(
			databaseUrl,
			`SELECT granted FROM pg_locks WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database()) AND classid = ${classid} AND objid = ${objid} ORDER BY granted DESC`,
		)
	).map((row) => row.granted);

const until = async (check: () => Promise<boolean>): Promise<void> => {
	const deadline = Date.now() + 5_000;
	while (!(await check())) {
		if (Date.now() > deadline) {
			throw new Error("Timed out waiting");
		}
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
};

const applied = async (databaseUrl: string): Promise<string[]> =>
	(
		await query<{ name: string }>(
			databaseUrl,
			"SELECT name FROM drizzle.__drizzle_migrations",
		)
	).map((row) => row.name);

describe("postgresMigrate", () => {
	it("refuses a URL that is not postgres:// or postgresql://", async () => {
		await expect(
			postgresMigrate({ databaseUrl: "memory://", migrationsFolder }),
		).rejects.toThrow(
			new TypeError(
				'Invalid database URL: found "memory://"; use postgres:// or postgresql://',
			),
		);
	});

	it("applies pending migrations, then finds nothing on a rerun", async () => {
		const databaseUrl = await postgresTestDatabaseCreate();

		await postgresMigrate({ databaseUrl, migrationsFolder });
		await postgresMigrate({ databaseUrl, migrationsFolder });

		expect(await applied(databaseUrl)).toEqual(["20261102000000_foo_create"]);
		expect(await query(databaseUrl, "SELECT * FROM foo.foo")).toEqual([]);
		expect(await lockStates(databaseUrl)).toEqual([]);
	});

	it("holds the advisory lock, so a concurrent run waits and then finds nothing", async () => {
		const databaseUrl = await postgresTestDatabaseCreate();

		const first = postgresMigrate({ databaseUrl, migrationsFolder });
		await until(async () => (await lockStates(databaseUrl)).length === 1);
		const second = postgresMigrate({ databaseUrl, migrationsFolder });
		await until(async () => (await lockStates(databaseUrl)).length === 2);

		expect(await lockStates(databaseUrl)).toEqual([true, false]);
		await Promise.all([first, second]);
		expect(await applied(databaseUrl)).toEqual(["20261102000000_foo_create"]);
		expect(await lockStates(databaseUrl)).toEqual([]);
	});
});
