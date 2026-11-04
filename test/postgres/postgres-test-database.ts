import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import { inject } from "vitest";

// Provided by postgres-global-setup.ts.
declare module "vitest" {
	export interface ProvidedContext {
		postgresAdminUrl: string;
		postgresContainer: string;
	}
}

const execFileAsync = promisify(execFile);

// A fresh, empty database per test file, so files running in parallel never share tables.
export const postgresTestDatabaseCreate = async (): Promise<string> => {
	const name = `test_${randomUUID().replaceAll("-", "")}`;
	await execFileAsync("docker", [
		"exec",
		inject("postgresContainer"),
		"psql",
		"--username=postgres",
		`--command=CREATE DATABASE ${name}`,
	]);
	const url = new URL(inject("postgresAdminUrl"));
	url.pathname = `/${name}`;
	return url.toString();
};
