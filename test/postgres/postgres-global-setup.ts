import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import type { TestProject } from "vitest/node";
// Loads the ProvidedContext keys this file provides.
import type {} from "./postgres-test-database.ts";

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" }).trim();

// Over TCP inside the container: the image's init server listens on the socket only, so this waits for the real one.
const ready = async (name: string): Promise<void> => {
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			docker(
				"exec",
				"--env",
				"PGPASSWORD=postgres",
				name,
				"psql",
				"--host=127.0.0.1",
				"--username=postgres",
				"--command=SELECT 1",
			);
			return;
		} catch (error) {
			if (Date.now() > deadline) {
				throw error;
			}
			await setTimeout(250);
		}
	}
};

// A throwaway Postgres 18 on a free port for this run, removed afterward. Any package's vitest config can list it.
// `timeout` ends the container after `lifetimeSeconds` and `--rm` removes it, even when teardown never runs.
export default async function postgresGlobalSetup(
	project: Pick<TestProject, "provide">,
	lifetimeSeconds = 1200,
): Promise<() => void> {
	const name = `baseline-postgres-test-${process.pid}`;
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
		"timeout",
		String(lifetimeSeconds),
		"docker-entrypoint.sh",
		"postgres",
	);
	const teardown = (): void => {
		docker("rm", "--force", "--volumes", name);
	};
	try {
		const hostPort = docker("port", name, "5432/tcp").split("\n")[0];
		await ready(name);
		project.provide(
			"postgresAdminUrl",
			`postgres://postgres:postgres@${hostPort}/postgres`,
		);
		project.provide("postgresContainer", name);
	} catch (error) {
		teardown();
		throw error;
	}
	return teardown;
}
