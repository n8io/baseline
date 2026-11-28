import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { loggerDefaultCreate } from "./logger-default.ts";

const moduleUrl = new URL("./logger-default.ts", import.meta.url).href;

/**
 * Runs `body` in a fresh Node process whose LOG_LEVEL is `level`, after it imported this module and
 * made `getter`. A failed import or body prints the error name and message to stderr, exit 1.
 */
const childRun = (level: string, body: string) =>
	spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import(${JSON.stringify(moduleUrl)}).then((m) => { const getter = m.loggerDefaultCreate(); ${body} }, (e) => { process.stderr.write(e.name + ": " + e.message); process.exit(1); });`,
		],
		{ encoding: "utf8", env: { ...process.env, LOG_LEVEL: level } },
	);

describe("loggerDefaultCreate", () => {
	it("makes a getter without throwing when LOG_LEVEL is not a level", () => {
		const result = childRun("verbose", 'process.stdout.write("made");');

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("made");
	});

	it("throws the LOG_LEVEL TypeError at the first call when LOG_LEVEL is not a level", () => {
		const result = childRun("verbose", "getter();");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("TypeError: LOG_LEVEL must be one of");
	});

	it("reads LOG_LEVEL at the first call, not when the getter is made", () => {
		const result = childRun(
			"silent",
			'process.env.LOG_LEVEL = "warn"; process.stdout.write(getter().level);',
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("warn");
	});

	it("returns the same logger on every call, whatever LOG_LEVEL becomes", () => {
		const result = childRun(
			"info",
			'const first = getter(); process.env.LOG_LEVEL = "verbose"; process.stdout.write(String(getter() === first) + first.level);',
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("trueinfo");
	});

	it("keeps one logger per getter", () => {
		const first = loggerDefaultCreate();
		const second = loggerDefaultCreate();

		expect(first()).toBe(first());
		expect(first()).not.toBe(second());
	});
});
