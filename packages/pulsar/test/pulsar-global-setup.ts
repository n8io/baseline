import { execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import type { TestProject } from "vitest/node";

declare module "vitest" {
	export interface ProvidedContext {
		pulsarToken: string;
		pulsarUrl: string;
	}
}

const docker = (...args: string[]): string =>
	execFileSync("docker", args, { encoding: "utf8", stdio: "pipe" }).trim();

const base64Url = (value: Buffer | string): string =>
	Buffer.from(value).toString("base64url");

// An HS256 JWT for `subject`, signed with the broker's secret key: what `bin/pulsar tokens create` makes.
const tokenCreate = (secretKey: Buffer, subject: string): string => {
	const unsigned = `${base64Url(JSON.stringify({ alg: "HS256" }))}.${base64Url(JSON.stringify({ sub: subject }))}`;
	const signature = createHmac("sha256", secretKey)
		.update(unsigned)
		.digest("base64url");
	return `${unsigned}.${signature}`;
};

// Standalone takes 20-40 s to start; the admin health check answers once the broker serves topics.
const ready = async (adminUrl: string, token: string): Promise<void> => {
	const deadline = Date.now() + 120_000;
	for (;;) {
		try {
			const response = await fetch(`${adminUrl}/admin/v2/brokers/health`, {
				headers: { authorization: `Bearer ${token}` },
			});
			if (response.ok) return;
		} catch {
			// Not listening yet.
		}
		if (Date.now() > deadline) {
			throw new Error(`Pulsar was not healthy within 120 s at ${adminUrl}`);
		}
		await setTimeout(1_000);
	}
};

// A throwaway Pulsar 5.0.1 standalone with JWT token authentication on free ports, removed afterward.
export default async function pulsarGlobalSetup(
	project: TestProject,
): Promise<() => void> {
	const name = `baseline-pulsar-test-${process.pid}`;
	const secretKey = randomBytes(32);
	const token = tokenCreate(secretKey, "admin");
	const config = {
		authenticationEnabled: "true",
		authenticationProviders:
			"org.apache.pulsar.broker.authentication.AuthenticationProviderToken",
		brokerClientAuthenticationParameters: `token:${token}`,
		brokerClientAuthenticationPlugin:
			"org.apache.pulsar.client.impl.auth.AuthenticationToken",
		superUserRoles: "admin",
		tokenSecretKey: `data:;base64,${secretKey.toString("base64")}`,
	};
	docker(
		"run",
		"--detach",
		"--name",
		name,
		...Object.entries(config).flatMap(([key, value]) => [
			"--env",
			`PULSAR_PREFIX_${key}=${value}`,
		]),
		"--publish",
		"127.0.0.1::6650",
		"--publish",
		"127.0.0.1::8080",
		"apachepulsar/pulsar:5.0.1",
		"sh",
		"-c",
		"bin/apply-config-from-env.py conf/standalone.conf && exec bin/pulsar standalone --no-functions-worker --no-stream-storage",
	);
	const teardown = (): void => {
		docker("rm", "--force", "--volumes", name);
	};
	try {
		const port = (containerPort: string): string =>
			docker("port", name, containerPort).split("\n")[0] ?? "";
		await ready(`http://${port("8080/tcp")}`, token);
		project.provide("pulsarUrl", `pulsar://${port("6650/tcp")}`);
		project.provide("pulsarToken", token);
	} catch (error) {
		teardown();
		throw error;
	}
	return teardown;
}
