import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	mkdirSync,
	mkdtempDisposableSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const guard = new URL("./node-version-require.ts", import.meta.url).pathname;

// The guard beside a package.json that asks for `node`; returns what a script preloading it does.
const scriptRun = (node: string) => {
	using folder = mkdtempDisposableSync(join(tmpdir(), "node-version-"));
	mkdirSync(join(folder.path, "scripts"));
	writeFileSync(
		join(folder.path, "package.json"),
		JSON.stringify({ engines: { node }, type: "module" }),
	);
	const copy = join(folder.path, "scripts/node-version-require.ts");
	copyFileSync(guard, copy);
	return spawnSync(
		process.execPath,
		["--import", copy, "-e", "console.log('ran')"],
		{ encoding: "utf8" },
	);
};

describe("node-version-require", () => {
	it("lets a script run on the Node the engines field asks for", () => {
		const run = scriptRun(">=26");

		expect(run.status).toBe(0);
		expect(run.stdout).toBe("ran\n");
	});

	it("stops a script on an older Node and names both versions", () => {
		const run = scriptRun(">=99");

		expect(run.status).toBe(1);
		expect(run.stdout).toBe("");
		expect(run.stderr).toBe(
			`This script needs Node 99, found ${process.versions.node}.\n`,
		);
	});
});
