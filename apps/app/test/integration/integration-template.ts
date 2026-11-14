import { readFileSync } from "node:fs";
import type pg from "pg";

// The Project's name as a SQL name: "invoicing-api" is invoicing_api.
const projectName: string = (
	JSON.parse(
		readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
	) as { name: string }
).name.replaceAll(/[^a-z0-9]/gi, "_");

export const integrationTemplateNameCreate = (project: string): string =>
	`${project}_template`;

export const integrationTemplateName =
	integrationTemplateNameCreate(projectName);

const commentCreate = (project: string): string =>
	`baseline-integration:${project}`;

// Drops and recreates the template database, but only one this Project made: it carries a comment
// naming the Project. A database of that name without it belongs to someone else, so the run stops.
export const integrationTemplateCreate = async (
	pgClient: pg.Client,
	project: string = projectName,
): Promise<void> => {
	const name = integrationTemplateNameCreate(project);
	const comment = commentCreate(project);
	const found = await pgClient.query<{ comment: string | null }>(
		"SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1",
		[name],
	);
	const [existing] = found.rows;
	if (existing !== undefined && existing.comment !== comment) {
		throw new Error(
			`The database ${name} exists and is not this Project's integration template (its comment is not '${comment}'). Integration tests point at the wrong Postgres, or ${name} is yours: set INTEGRATION_DATABASE_URL to this Project's Postgres.`,
		);
	}
	const identifier = pgClient.escapeIdentifier(name);
	await pgClient.query(`DROP DATABASE IF EXISTS ${identifier} WITH (FORCE)`);
	await pgClient.query(`CREATE DATABASE ${identifier}`);
	await pgClient.query(
		`COMMENT ON DATABASE ${identifier} IS ${pgClient.escapeLiteral(comment)}`,
	);
};
