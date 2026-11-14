import { randomUUID } from "node:crypto";
import pg from "pg";
import { describe, expect, inject, it, onTestFinished } from "vitest";
import { integrationTemplateCreate } from "./integration-template.ts";

const clientCreate = async (): Promise<pg.Client> => {
	const pgClient = new pg.Client({
		connectionString: inject("integrationDatabaseUrl"),
	});
	await pgClient.connect();
	onTestFinished(() => pgClient.end());
	return pgClient;
};

const existsQuery = async (pgClient: pg.Client, name: string) =>
	(await pgClient.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]))
		.rowCount === 1;

describe("integrationTemplateCreate", () => {
	it("leaves a database of that name alone when it is not this Project's template", async () => {
		const pgClient = await clientCreate();
		const project = `other_${randomUUID().replaceAll("-", "")}`;
		const name = `${project}_template`;
		await pgClient.query(`CREATE DATABASE ${name}`);
		onTestFinished(async () => {
			await pgClient.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
		});

		await expect(integrationTemplateCreate(pgClient, project)).rejects.toThrow(
			name,
		);
		expect(await existsQuery(pgClient, name)).toBe(true);
	});

	it("recreates its own template, marked with the Project's name", async () => {
		const pgClient = await clientCreate();
		const project = `mine_${randomUUID().replaceAll("-", "")}`;
		const name = `${project}_template`;
		onTestFinished(async () => {
			await pgClient.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
		});

		await integrationTemplateCreate(pgClient, project);
		await integrationTemplateCreate(pgClient, project);

		const { rows } = await pgClient.query(
			"SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
			[name],
		);
		expect(rows).toEqual([{ comment: `baseline-integration:${project}` }]);
	});
});
