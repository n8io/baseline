import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { createClient } from "redis";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		redisUrl: string;
	}
}

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8" }).trim();

const ready = async (url: string): Promise<void> => {
	const deadline = Date.now() + 60_000;
	for (;;) {
		const redisClient = createClient({
			socket: { reconnectStrategy: false },
			url,
		});
		redisClient.on("error", () => undefined);
		try {
			await redisClient.connect();
			await redisClient.ping();
			redisClient.destroy();
			return;
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
	const name = `baseline-live-test-${process.pid}`;
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
		const url = `redis://${hostPort}`;
		await ready(url);
		project.provide("redisUrl", url);
	} catch (error) {
		teardown();
		throw error;
	}
	return teardown;
}
