import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { argsParse } from "./args.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(["./args.ts"], { query: "?raw" });

const usage = "Usage: pnpm demo <name> [--loud]\n\n  -h, --help  this help";

// Runs argsParse in a child process, where its output and exit code can be read.
const demoRun = (args: string[]) => {
	const module = new URL("./args.ts", import.meta.url).pathname;
	const child = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`import { argsParse } from ${JSON.stringify(module)};
const parsed = argsParse({ allowPositionals: true, args: ${JSON.stringify(args)}, options: { loud: { type: "boolean" } }, usage: ${JSON.stringify(usage)} });
if (parsed !== undefined) console.log(JSON.stringify(parsed));`,
		],
		{ encoding: "utf8" },
	);
	return { code: child.status, stderr: child.stderr, stdout: child.stdout };
};

describe("argsParse", () => {
	it("returns the values and positionals", () => {
		const parsed = argsParse({
			allowPositionals: true,
			args: ["invoicing", "--loud"],
			options: { loud: { type: "boolean" } },
			usage,
		});

		expect(parsed?.positionals).toEqual(["invoicing"]);
		expect(parsed?.values.loud).toBe(true);
	});

	it("returns no positionals when none are given", () => {
		const child = demoRun(["--loud"]);

		expect(child.code).toBe(0);
		expect(JSON.parse(child.stdout)).toMatchObject({
			positionals: [],
			values: { loud: true },
		});
	});

	it("prints the usage to stdout for --help and for -h, and returns nothing", () => {
		for (const flag of ["--help", "-h"]) {
			const child = demoRun([flag]);

			expect(child.code).toBe(0);
			expect(child.stdout).toBe(`${usage}\n`);
			expect(child.stderr).toBe("");
		}
	});

	it("prints the error and the usage to stderr, and sets exit code 1, for an unknown option", () => {
		const child = demoRun(["--quiet"]);

		expect(child.code).toBe(1);
		expect(child.stdout).toBe("");
		expect(child.stderr).toMatch(/^demo: .*--quiet/);
		expect(child.stderr).toContain(usage);
	});
});
