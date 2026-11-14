import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";
import { integrationTemplateName } from "./integration-template.ts";

const adminQuery = async (text: string): Promise<void> => {
	const pgClient = new pg.Client({
		connectionString: inject("integrationDatabaseUrl"),
	});
	await pgClient.connect();
	try {
		await pgClient.query(text);
	} finally {
		await pgClient.end();
	}
};

// A migrated, empty database copied from the template database (about 8 ms). `drop` removes it,
// closing any connection still open; `await using` drops it at the end of the block.
export const integrationDatabaseCreate = async (): Promise<
	AsyncDisposable & { databaseUrl: string; drop: () => Promise<void> }
> => {
	const name = `test_${randomUUID().replaceAll("-", "")}`;
	await adminQuery(
		`CREATE DATABASE "${name}" TEMPLATE "${integrationTemplateName}"`,
	);
	const url = new URL(inject("integrationDatabaseUrl"));
	url.pathname = `/${name}`;
	const drop = () =>
		adminQuery(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
	return { databaseUrl: url.toString(), drop, [Symbol.asyncDispose]: drop };
};
