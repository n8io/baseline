import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import globalSetup from "./postgres-global-setup.ts";

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8" }).trim();

test("the container ends and is removed after its lifetime, even when teardown never runs", async () => {
	await globalSetup({ provide: () => undefined }, 10);
	const name = `baseline-postgres-test-${process.pid}`;
	expect(
		JSON.parse(docker("inspect", "--format", "{{json .Config.Cmd}}", name)),
	).toEqual(expect.arrayContaining(["timeout", "10"]));
	await expect
		.poll(
			() => docker("ps", "--all", "--quiet", "--filter", `name=^${name}$`),
			{
				interval: 1_000,
				timeout: 60_000,
			},
		)
		.toBe("");
}, 120_000);
