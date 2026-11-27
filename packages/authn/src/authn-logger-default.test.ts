import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { authnLoggerDefault } from "./authn-logger-default.ts";

const moduleUrl = new URL("./authn-logger-default.ts", import.meta.url).href;

/** Runs `body` in a fresh Node process that has imported the default module with LOG_LEVEL `level`. */
const childRun = (level: string, body: string) =>
	spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import(${JSON.stringify(moduleUrl)}).then((m) => { ${body} }, (e) => { process.stderr.write(e.name + ": " + e.message); process.exit(1); });`,
		],
		{ encoding: "utf8", env: { ...process.env, LOG_LEVEL: level } },
	);

describe("authn logger default", () => {
	it("imports without throwing when LOG_LEVEL is not a level", () => {
		const result = childRun("verbose", 'process.stdout.write("imported");');

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(result.stdout).toBe("imported");
	});

	it("builds the logger on the first call, then returns the same one", () => {
		const first = authnLoggerDefault();

		expect(first.info).toBeTypeOf("function");
		expect(authnLoggerDefault()).toBe(first);
	});

	it("works when called with a valid LOG_LEVEL", () => {
		const result = childRun(
			"silent",
			"process.stdout.write(m.authnLoggerDefault().level);",
		);

		expect(result.status).toBe(0);
		expect(result.stdout).toBe("silent");
	});

	it("throws the LOG_LEVEL TypeError when called with a bad LOG_LEVEL", () => {
		const result = childRun("verbose", "m.authnLoggerDefault();");

		expect(result.status).toBe(1);
		expect(result.stderr).toContain("LOG_LEVEL must be one of");
	});
});
