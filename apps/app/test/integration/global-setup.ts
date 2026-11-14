import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import pg from "pg";
import type { TestProject } from "vitest/node";
import {
	integrationTemplateCreate,
	integrationTemplateName,
} from "./integration-template.ts";

declare module "vitest" {
	export interface ProvidedContext {
		// piece-start: redis
		integrationCacheUrl: string;
		// piece-end: redis
		integrationDatabaseUrl: string;
	}
}

// Only INTEGRATION_* URLs count, so a DATABASE_URL set for something else is never dropped into. Without
// them, the compose.yaml services on this Project's host ports (CI's service containers use the defaults).
// This Project's host ports: the shell's, else the defaults in .env.schema (not loaded through varlock, so
// a .env.development.local with op() references cannot stop the run).
const schemaPorts = parseEnv(
	readFileSync(new URL("../../.env.schema", import.meta.url), "utf8"),
);
const portRead = (item: string): string | undefined =>
	process.env[item] ?? schemaPorts[item];

const urlCreate = (
	value: string | undefined,
	fallback: () => string,
): string => (value !== undefined && value !== "" ? value : fallback());

// Runs src/migrate.ts once against a fresh template database (integration-template.ts); each test
// file copies it (integrationDatabaseCreate). One Postgres and one Redis per run.
export default async function integrationGlobalSetup(
	project: TestProject,
): Promise<void> {
	const databaseUrl = urlCreate(
		process.env.INTEGRATION_DATABASE_URL,
		() =>
			`postgres://baseline:baseline@localhost:${portRead("POSTGRES_HOST_PORT")}/baseline`,
	);
	// piece-start: redis
	const cacheUrl = urlCreate(
		process.env.INTEGRATION_CACHE_URL,
		() => `redis://localhost:${portRead("REDIS_HOST_PORT")}`,
	);
	project.provide("integrationCacheUrl", cacheUrl);
	// piece-end: redis
	const pgClient = new pg.Client({ connectionString: databaseUrl });
	await pgClient.connect();
	try {
		await integrationTemplateCreate(pgClient);
	} finally {
		await pgClient.end();
	}
	const templateUrl = new URL(databaseUrl);
	templateUrl.pathname = `/${integrationTemplateName}`;
	execFileSync("node", ["--import", "varlock/auto-load", "src/migrate.ts"], {
		env: {
			...process.env,
			APP_ENV: "test",
			DATABASE_URL: templateUrl.toString(),
		},
		stdio: "inherit",
	});
	project.provide("integrationDatabaseUrl", databaseUrl);
}
