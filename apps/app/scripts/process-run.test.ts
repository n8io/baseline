import { spawnSync } from "node:child_process";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitRun, processRun } from "./process-run.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(["./process-run.ts"], { query: "?raw" });

describe("processRun", () => {
	it("returns the stdout of the command", () => {
		expect(
			processRun({
				command: process.execPath,
				args: ["-e", "process.stdout.write('hello')"],
			}),
		).toBe("hello");
	});

	it("runs the command in the given directory with the given environment", () => {
		using folder = mkdtempDisposableSync(join(tmpdir(), "process-run-"));
		const output = processRun({
			command: process.execPath,
			args: ["-e", "process.stdout.write(process.cwd() + ':' + process.env.X)"],
			options: { cwd: folder.path, env: { ...process.env, X: "1" } },
		});
		expect(output.endsWith(":1")).toBe(true);
		expect(output).toContain("process-run-");
	});

	it("passes the input to the command", () => {
		expect(
			processRun({
				command: process.execPath,
				args: ["-e", "process.stdin.pipe(process.stdout)"],
				options: { input: "piped" },
			}),
		).toBe("piped");
	});

	it("keeps a working command's stderr out of the terminal", () => {
		const module = new URL("./process-run.ts", import.meta.url).pathname;
		const child = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`import { processRun } from ${JSON.stringify(module)};
processRun({ command: process.execPath, args: ["-e", "process.stderr.write('error: could not apply')"] });`,
			],
			{ encoding: "utf8" },
		);

		expect(child.status).toBe(0);
		expect(child.stderr).toBe("");
	});

	it("throws, carrying stderr, when the command fails", () => {
		expect(() =>
			processRun({
				command: process.execPath,
				args: ["-e", "console.error('boom'); process.exit(3)"],
			}),
		).toThrow(/boom/);
	});

	it("returns an empty string when the command inherits its output", () => {
		expect(
			processRun({
				command: process.execPath,
				args: ["-e", ""],
				options: { inherit: true },
			}),
		).toBe("");
	});
});

describe("gitRun", () => {
	it("runs git in the directory", () => {
		using folder = mkdtempDisposableSync(join(tmpdir(), "git-run-"));
		gitRun(folder.path, ["init", "--quiet"]);
		expect(gitRun(folder.path, ["rev-parse", "--is-inside-work-tree"])).toBe(
			"true\n",
		);
	});

	it("throws when git fails", () => {
		using folder = mkdtempDisposableSync(join(tmpdir(), "git-run-"));
		expect(() => gitRun(folder.path, ["rev-parse", "HEAD"])).toThrow();
	});
});
