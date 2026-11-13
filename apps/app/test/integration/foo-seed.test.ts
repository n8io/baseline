import { spawn } from "node:child_process";
import { once } from "node:events";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";

// `pnpm seed`: native TS with varlock through the preload alone.
const seedRun = async (databaseUrl: string): Promise<number | null> => {
	const child = spawn(
		"node",
		["--import", "varlock/auto-load", "src/seed.ts"],
		{
			env: {
				...process.env,
				APP_ENV: "development",
				CACHE_URL: "memory://",
				DATABASE_URL: databaseUrl,
			},
			stdio: ["ignore", "ignore", "inherit"],
		},
	);
	const [code] = await once(child, "exit");
	return code as number | null;
};

const fooNames = async (databaseUrl: string): Promise<string[]> => {
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		const { rows } = await pgClient.query<{ name: string }>(
			"SELECT name FROM foo.foo ORDER BY name",
		);
		return rows.map((row) => row.name);
	} finally {
		await pgClient.end();
	}
};

describe("src/seed.ts on Postgres", { timeout: 60_000 }, () => {
	it("seeds an empty database once and exits 0", async () => {
		await using database = await integrationDatabaseCreate();

		expect(await seedRun(database.databaseUrl)).toBe(0);
		expect(await seedRun(database.databaseUrl)).toBe(0);
		expect(await fooNames(database.databaseUrl)).toEqual([
			"Alpha",
			"Beta",
			"Gamma",
		]);
	});
});
