import { spawnSync } from "node:child_process";
import { mkdtempDisposableSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pieceNames } from "./pieces.ts";

// The files this test reads or runs from disk, so `pnpm test --changed` runs it when one changes.
import.meta.glob(["./piece-remove.ts"], { query: "?raw" });

// Runs the command in an empty folder: every case here stops before it touches a Project.
const commandRun = (args: string[]) => {
	using folder = mkdtempDisposableSync(join(tmpdir(), "piece-remove-command-"));
	const script = new URL("./piece-remove.ts", import.meta.url).pathname;
	return spawnSync(process.execPath, [script, ...args], {
		cwd: folder.path,
		encoding: "utf8",
	});
};

describe("piece-remove", () => {
	it("prints the usage to stdout for --help and exits 0", () => {
		const { status, stderr, stdout } = commandRun(["--help"]);

		expect(stdout).toBe(`Usage: pnpm piece-remove <${pieceNames.join("|")}>\n`);
		expect(stderr).toBe("");
		expect(status).toBe(0);
	});

	it("prints the usage to stderr and exits 1 without a Piece, or with an unknown one", () => {
		for (const args of [[], ["pages"], ["ui", "live"]]) {
			const { status, stderr } = commandRun(args);

			expect(stderr).toBe(
				`Usage: pnpm piece-remove <${pieceNames.join("|")}>\n`,
			);
			expect(status).toBe(1);
		}
	});

	it("prints the error and the usage to stderr and exits 1 for an unknown option", () => {
		const { status, stderr } = commandRun(["--force"]);

		expect(stderr).toMatch(
			/^piece-remove: .*--force[\s\S]*Usage: pnpm piece-remove/,
		);
		expect(status).toBe(1);
	});
});
