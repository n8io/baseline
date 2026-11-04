import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import globalSetup from "./pulsar-global-setup.ts";

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8" }).trim();

test("the container ends and is removed after its lifetime, even when teardown never runs", async () => {
	await globalSetup({ provide: () => undefined }, 60);
	const name = `baseline-pulsar-test-${process.pid}`;
	expect(
		JSON.parse(docker("inspect", "--format", "{{json .Config.Cmd}}", name)),
	).toEqual(expect.arrayContaining(["timeout", "60"]));
	await expect
		.poll(
			() => docker("ps", "--all", "--quiet", "--filter", `name=^${name}$`),
			{
				interval: 1_000,
				timeout: 120_000,
			},
		)
		.toBe("");
}, 240_000);
