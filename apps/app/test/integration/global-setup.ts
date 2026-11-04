import { execFileSync } from "node:child_process";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		integrationCacheUrl: string;
		integrationDatabaseUrl: string;
	}
}

// The compose.yaml services (CI's service containers use the same ports), unless the run passes real URLs.
const realUrl = (value: string | undefined, fallback: string): string =>
	value?.startsWith("memory:") === false ? value : fallback;

export const integrationTemplateName = "baseline_template";

// Runs src/migrate.ts once against a fresh baseline_template database; each test file copies it
// (integrationDatabaseCreate). One Postgres and one Redis per run.
export default async function integrationGlobalSetup(
	project: TestProject,
): Promise<void> {
	const databaseUrl = realUrl(
		process.env.DATABASE_URL,
		"postgres://baseline:baseline@localhost:5432/baseline",
	);
	const cacheUrl = realUrl(process.env.CACHE_URL, "redis://localhost:6379");
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		await pgClient.query(
			`DROP DATABASE IF EXISTS ${integrationTemplateName} WITH (FORCE)`,
		);
		await pgClient.query(`CREATE DATABASE ${integrationTemplateName}`);
	} finally {
		await pgClient.end();
	}
	const templateUrl = new URL(databaseUrl);
	templateUrl.pathname = `/${integrationTemplateName}`;
	execFileSync("node", ["--import", "varlock/auto-load", "src/migrate.ts"], {
		env: {
			...process.env,
			APP_ENV: "test",
			CACHE_URL: cacheUrl,
			DATABASE_URL: templateUrl.toString(),
		},
		stdio: "inherit",
	});
	project.provide("integrationCacheUrl", cacheUrl);
	project.provide("integrationDatabaseUrl", databaseUrl);
}
