import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";

// Runs `node src/seed.ts` the way `pnpm seed` does: varlock through the preload alone.
const seedRun = async (env: Record<string, string>) => {
	const child = spawn(
		"node",
		["--import", "varlock/auto-load", "src/seed.ts"],
		{
			// Without __VARLOCK_ENV, the child loads its own env instead of reusing this worker's.
			env: { ...process.env, __VARLOCK_ENV: undefined, ...env },
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += String(chunk);
	});
	child.stderr.on("data", (chunk) => {
		output += String(chunk);
	});
	const [code] = await once(child, "exit");
	return { code, output };
};

describe("src/seed.ts", () => {
	it("refuses to run in production", async () => {
		const { code, output } = await seedRun({
			APP_ENV: "production",
			AUTHN_AUDIENCE: "app",
			AUTHN_CLIENT_ID: "app",
			AUTHN_CLIENT_SECRET: "not-a-real-secret",
			AUTHN_ISSUER_URL: "https://issuer.example.com",
			AUTHN_SECRET: "jUu2hFjuWWolGyWs2mQxArUaISmTrSlPtXwF7PtYmzc",
			CACHE_URL: "redis://cache.example.com",
			DATABASE_URL: "postgres://db.example.com/app",
			// Every op() item is set here, so varlock never asks 1Password.
			OP_SERVICE_ACCOUNT_TOKEN: "ops_not-a-real-token",
		});
		expect(code).toBe(1);
		expect(output).toContain(
			"Seeds run only in development and test: APP_ENV is production",
		);
	});

	it("leaves a memory database to the server and exits 0", async () => {
		const { code, output } = await seedRun({
			APP_ENV: "development",
			CACHE_URL: "memory://",
			DATABASE_URL: "memory://",
			LOG_LEVEL: "info",
		});
		expect(code).toBe(0);
		expect(output).toContain("memory database: the server seeds itself");
	});
});
