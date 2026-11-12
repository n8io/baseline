import { pino } from "pino";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("logger", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("reads its level from LOG_LEVEL", async () => {
		vi.stubEnv("LOG_LEVEL", "silent");
		const { logger } = await import("./index.ts");

		expect(logger.level).toBe("silent");
	});

	it("defaults to info when LOG_LEVEL is unset or empty", async () => {
		vi.stubEnv("LOG_LEVEL", undefined);
		expect((await import("./index.ts")).logger.level).toBe("info");

		vi.resetModules();
		vi.stubEnv("LOG_LEVEL", "");
		expect((await import("./index.ts")).logger.level).toBe("info");
	});

	it("logs an error with its class name as msg, never its message", () => {
		const { lines, logger } = loggerCapture();
		logger.error(new TypeError(canary));
		logger.error({ err: new RangeError(canary), route: "GET /foos" });

		expect(lines.map((line) => line.msg)).toEqual(["TypeError", "RangeError"]);
		expect(lines[0]?.err).toMatchObject({ type: "TypeError" });
		expect(lines[1]).toMatchObject({ route: "GET /foos" });
		expect(JSON.stringify(lines)).not.toContain(canary);
	});

	it("keeps a message the caller gives", () => {
		const { lines, logger } = loggerCapture();
		logger.error({ err: new Error(canary) }, "request failed");
		logger.error({ err: new Error(canary), msg: "query failed" });

		expect(lines.map((line) => line.msg)).toEqual([
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
