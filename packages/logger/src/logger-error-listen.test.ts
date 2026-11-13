import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { loggerErrorListen } from "./logger-error-listen.ts";
import { loggerOptionsCreate } from "./logger-options.ts";

const loggerSilentCreate = (level = "trace") =>
	pino(loggerOptionsCreate(level), { write: () => undefined });

describe("loggerErrorListen", () => {
	it("hears each err logged at error or fatal, in either call shape", () => {
		const logger = loggerSilentCreate();
		const heard: unknown[] = [];
		const stop = loggerErrorListen((error) => heard.push(error));
		const first = new Error("first");
		const second = new TypeError("second");

		logger.error({ err: first }, "Postgres idle client error");
		logger.fatal(second);
		stop();

		expect(heard).toEqual([first, second]);
	});

	it("does not hear a warning, a call with no err, or anything after stop", () => {
		const logger = loggerSilentCreate();
		const heard: unknown[] = [];
		const stop = loggerErrorListen((error) => heard.push(error));

		logger.warn({ err: new Error("warned") });
		logger.error("Resource still open at the deadline");
		stop();
		logger.error({ err: new Error("after stop") });

		expect(heard).toEqual([]);
	});

	it("still logs when a listener throws, and calls the other listeners", () => {
		const lines: string[] = [];
		const logger = pino(loggerOptionsCreate("info"), {
			write: (line: string) => lines.push(line),
		});
		const heard: unknown[] = [];
		const stops = [
			loggerErrorListen(() => {
				throw new Error("listener failed");
			}),
			loggerErrorListen((error) => heard.push(error)),
		];
		const error = new Error("boom");

		logger.error({ err: error });
		for (const stop of stops) stop();

		expect(heard).toEqual([error]);
		expect(lines).toHaveLength(1);
	});
});
