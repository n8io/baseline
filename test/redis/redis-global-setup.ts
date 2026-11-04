import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		redisUrl: string;
	}
}

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" }).trim();

// Pings inside the container, like the Postgres setup, so this file needs no Redis client of its own.
const ready = async (name: string): Promise<void> => {
	const deadline = Date.now() + 60_000;
	for (;;) {
		try {
			const reply = docker("exec", name, "redis-cli", "ping");
			if (reply === "PONG") return;
			throw new Error(`Redis answered ${reply}`);
		} catch (error) {
			if (Date.now() > deadline) throw error;
			await setTimeout(250);
		}
	}
};

// A throwaway Redis 8 on a free port for this run, removed afterward.
// `timeout` ends the container after `lifetimeSeconds` and `--rm` removes it, even when teardown never runs.
export default async function redisGlobalSetup(
	project: Pick<TestProject, "provide">,
	lifetimeSeconds = 1200,
): Promise<() => void> {
	const name = `baseline-redis-test-${process.pid}`;
	docker(
		"run",
		"--detach",
		"--rm",
		"--name",
		name,
		"--publish",
		"127.0.0.1::6379",
		"redis:8",
		"timeout",
		String(lifetimeSeconds),
		"docker-entrypoint.sh",
		"redis-server",
	);
	const teardown = (): void => {
		docker("rm", "--force", "--volumes", name);
	};
	try {
		const hostPort = docker("port", name, "6379/tcp").split("\n")[0];
		await ready(name);
		project.provide("redisUrl", `redis://${hostPort}`);
	} catch (error) {
		teardown();
		throw error;
	}
	return teardown;
}
