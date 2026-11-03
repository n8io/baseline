import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

describe("varlock redaction of stdout", { timeout: 30_000 }, () => {
	it("masks a sensitive value in pino's stdout lines (V32)", async () => {
		const secret = `canary-client-secret-${randomUUID()}`;
		const child = spawn(
			process.execPath,
			[
				"--import",
				"varlock/auto-load",
				"test/integration/redaction-probe.ts",
			],
			{
				env: {
					...process.env,
					__VARLOCK_ENV: undefined,
					APP_ENV: "test",
					AUTHN_CLIENT_SECRET: secret,
					LOG_LEVEL: "info",
				},
				// A pipe, not a TTY: varlock redacts only streams nobody watches live.
				stdio: ["ignore", "pipe", "inherit"],
			},
		);
		let stdout = "";
		child.stdout?.on("data", (chunk) => {
			stdout += String(chunk);
		});
		const [code] = await once(child, "exit");

		expect(code).toBe(0);
		expect(stdout).toContain('"msg":"redaction probe"');
		expect(stdout).toContain('"clientSecret":"ca▒');
		expect(stdout).not.toContain(secret);
	});
});
