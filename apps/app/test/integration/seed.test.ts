import { spawn } from "node:child_process";
import { once } from "node:events";
import pg from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { integrationDatabaseCreate } from "./integration-database.ts";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

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

describe("src/seed.ts on Postgres", () => {
	it("seeds an empty database once and exits 0", async () => {
		const { databaseUrl, drop } = await integrationDatabaseCreate();
		cleanups.push(drop);

		expect(await seedRun(databaseUrl)).toBe(0);
		expect(await seedRun(databaseUrl)).toBe(0);
		expect(await fooNames(databaseUrl)).toEqual(["Alpha", "Beta", "Gamma"]);
	});
});
