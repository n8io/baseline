import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		postgresAdminUrl: string;
	}
}

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8" }).trim();

const ready = async (url: string): Promise<void> => {
	const deadline = Date.now() + 60_000;
	for (;;) {
		const pgClient = new pg.Client({ connectionString: url });
		try {
			await pgClient.connect();
			await pgClient.query("SELECT 1");
			return;
		} catch (error) {
			if (Date.now() > deadline) {
				throw error;
			}
			await setTimeout(250);
		} finally {
			await pgClient.end().catch(() => undefined);
		}
	}
};

// A throwaway Postgres 18 on a free port for this run, removed afterward.
export default async function queueGlobalSetup(
	project: TestProject,
): Promise<() => void> {
	const name = `baseline-queue-test-${process.pid}`;
	docker(
		"run",
		"--detach",
		"--rm",
		"--name",
		name,
		"--env",
		"POSTGRES_PASSWORD=postgres",
		"--publish",
		"127.0.0.1::5432",
		"postgres:18",
	);
	const teardown = (): void => {
		docker("rm", "--force", name);
	};
	try {
		const hostPort = docker("port", name, "5432/tcp").split("\n")[0];
		const url = `postgres://postgres:postgres@${hostPort}/postgres`;
		await ready(url);
		project.provide("postgresAdminUrl", url);
	} catch (error) {
		teardown();
		throw error;
	}
	return teardown;
}
