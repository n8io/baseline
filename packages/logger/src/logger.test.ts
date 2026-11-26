import { spawnSync } from "node:child_process";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { loggerCreate } from "./logger.ts";
import { loggerOptionsCreate } from "./logger-options.ts";

const canary = "canary@example.com";

const loggerCapture = () => {
	const lines: Record<string, unknown>[] = [];
	const stream = {
		write: (line: string) => {
			lines.push(JSON.parse(line) as Record<string, unknown>);
		},
	};
	return { lines, logger: pino(loggerOptionsCreate("info"), stream) };
};

const loggerModuleUrl = new URL("./logger.ts", import.meta.url).href;

/** Imports the real logger module in a fresh Node process whose LOG_LEVEL is `level` (unset when undefined). */
const loggerImport = (level: string | undefined) => {
	const env = { ...process.env };
	delete env["LOG_LEVEL"];
	if (level !== undefined) env["LOG_LEVEL"] = level;
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import(${JSON.stringify(loggerModuleUrl)}).then((m) => { let created; try { created = m.loggerCreate().level; } catch (e) { created = e.name + ": " + e.message; } process.stdout.write(created); }, (e) => { process.stderr.write(e.name + ": " + e.message); process.exit(1); });`,
		],
		{ encoding: "utf8", env },
	);
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
	};
};

describe("logger", () => {
	it("reads its level from LOG_LEVEL", () => {
		expect(loggerImport("silent").stdout).toBe("silent");
	});

	it("defaults to info when LOG_LEVEL is unset or empty", () => {
		expect(loggerImport(undefined).stdout).toBe("info");
		expect(loggerImport("").stdout).toBe("info");
	});

	it("imports without throwing when LOG_LEVEL is not a level, and loggerCreate throws a clear error", () => {
		const result = loggerImport("verbose");

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe(
			'TypeError: LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent, found "verbose"',
		);
	});

	it("loggerCreate takes its level from the options over LOG_LEVEL", () => {
		expect(loggerCreate({ level: "debug" }).level).toBe("debug");
		expect(() => loggerCreate({ level: "verbose" })).toThrow(
			'LOG_LEVEL must be one of fatal, error, warn, info, debug, trace, silent, found "verbose"',
		);
	});

	it("logs an error with its class name as msg, never its message", () => {
		const { lines, logger } = loggerCapture();
		logger.error(new TypeError(canary));
		logger.error({ err: new RangeError(canary), route: "GET /foos" });

		expect(lines.map((line) => line["msg"])).toEqual([
			"TypeError",
			"RangeError",
		]);
		expect(lines[0]?.["err"]).toMatchObject({ type: "TypeError" });
		expect(lines[1]).toMatchObject({ route: "GET /foos" });
		expect(JSON.stringify(lines)).not.toContain(canary);
	});

	it("keeps a message the caller gives", () => {
		const { lines, logger } = loggerCapture();
		logger.error({ err: new Error(canary) }, "request failed");
		logger.error({ err: new Error(canary), msg: "query failed" });

		expect(lines.map((line) => line["msg"])).toEqual([
			"request failed",
			"query failed",
		]);
		expect(JSON.stringify(lines)).not.toContain(canary);
	});

	it("redacts credentials at the top level and in headers", () => {
		const { lines, logger } = loggerCapture();
		logger.info({
			accessToken: canary,
			req: { headers: { authorization: canary, cookie: canary } },
			res: { headers: { "set-cookie": canary } },
			session: { refresh_token: canary },
		});

		expect(lines[0]).toMatchObject({
			accessToken: "[Redacted]",
			req: { headers: { authorization: "[Redacted]", cookie: "[Redacted]" } },
			res: { headers: { "set-cookie": "[Redacted]" } },
			session: { refresh_token: "[Redacted]" },
		});
		expect(JSON.stringify(lines)).not.toContain(canary);
	});
});
