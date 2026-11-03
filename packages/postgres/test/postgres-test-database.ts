import { randomUUID } from "node:crypto";
import pg from "pg";
import { inject } from "vitest";

// A fresh, empty database per test file, so files running in parallel never share tables.
export const postgresTestDatabaseCreate = async (): Promise<string> => {
	const adminUrl = inject("postgresAdminUrl");
	const name = `test_${randomUUID().replaceAll("-", "")}`;
	const pgClient = new pg.Client({ connectionString: adminUrl });
	await pgClient.connect();
	try {
		await pgClient.query(`CREATE DATABASE ${name}`);
	} finally {
		await pgClient.end();
	}
	const url = new URL(adminUrl);
	url.pathname = `/${name}`;
	return url.toString();
};
