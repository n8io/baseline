import { spawn } from "node:child_process";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { productionServerStart } from "./production-server.ts";

// Runs `pnpm api-smoke` the way a developer does: the preload alone, then the script.
const apiSmokeRun = async (args: string[]) => {
	const child = spawn(
		process.execPath,
		["--import", "./src/preload.ts", "scripts/api-smoke.ts", ...args],
		{
			// Without __VARLOCK_ENV, the child loads its own env instead of reusing this worker's.
			env: {
				...process.env,
				__VARLOCK_ENV: undefined,
				LOG_LEVEL: "fatal",
				// No collector runs here, and a failed last export would hold the exit for seconds.
				OTEL_LOGS_EXPORTER: "none",
				OTEL_METRICS_EXPORTER: "none",
				OTEL_TRACES_EXPORTER: "none",
			},
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	let output = "";
	for (const stream of [child.stdout, child.stderr]) {
		stream.on("data", (chunk) => {
			output += String(chunk);
		});
	}
	const [code] = await once(child, "close");
	return { code: code as number | null, output };
};

describe("pnpm api-smoke", { timeout: 60_000 }, () => {
	it("calls every route that needs no input on a served memory app and exits 0", async () => {
		await using server = await productionServerStart({
			databaseUrl: "memory://",
		});

		const { code, output } = await apiSmokeRun(["--url", server.url]);

		expect(output).toContain("ok   GET /api/v1/openapi.json 200");
		expect(output).toMatch(/api-smoke: (\d+) of \1 calls ok/);
		expect(output).not.toContain("FAIL");
		expect(code).toBe(0);
	});

	it("exits 1 and says why when nothing answers before the deadline", async () => {
		const { code, output } = await apiSmokeRun([
			"--url",
			"http://127.0.0.1:1",
			"--wait",
			"1",
		]);

		expect(output).toContain("did not answer in time");
		expect(code).toBe(1);
	});
});
