// The npm registry of the Project's repository: what clients-release asks npm for, and the
// tarballs it unpacks to compare against.
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processRun } from "./process-run.ts";

const registry = "https://npm.pkg.github.com";

// Status and output are the answer (a 404 means not published), so this runs through spawnSync,
// not processRun.
export const npm = (args: string[], cwd?: string | null) =>
	spawnSync("npm", [...args, "--registry", registry], {
		cwd: cwd ?? undefined,
		encoding: "utf8",
	});

const npmMissingIs = ({ stderr, stdout }: { stderr: string; stdout: string }) =>
	/E404|ETARGET/.test(`${stdout}${stderr}`);

// The newest version of `name` in `major`, or undefined when npm has none.
export const versionLatest = (
	name: string,
	major: number,
): string | undefined => {
	const view = npm(["view", `${name}@^${major}`, "version", "--json"]);
	if (view.status !== 0) {
		if (npmMissingIs(view)) return undefined;
		throw new Error(`npm view ${name} failed:\n${view.stderr}`);
	}
	const versions = [
		JSON.parse(view.stdout || "[]") as string | string[],
	].flat();
	return versions
		.sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
		.at(-1);
};

// Waits, up to 3 minutes, until npm shows each new version: npm lists one about a minute after
// the publish, and the next run (runs go one at a time) would otherwise pick the same version.
export const registryWait = (specs: string[]): void => {
	for (const spec of specs) {
		for (
			let tries = 0;
			npm(["view", spec, "version"]).stdout.trim() === "";
			tries++
		) {
			if (tries === 18)
				throw new Error(`npm does not show ${spec} after 3 minutes`);
			Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000);
		}
	}
};

// Unpacks the published `spec` into `folder`; leaves no folder when npm has no such version.
export const tarballUnpack = (spec: string, folder: string): void => {
	const pack = npm(["pack", spec, "--json"], tmpdir());
	if (pack.status !== 0) {
		if (npmMissingIs(pack)) return;
		throw new Error(`npm pack ${spec} failed:\n${pack.stderr}`);
	}
	const [{ filename } = { filename: "" }] = JSON.parse(pack.stdout) as {
		filename: string;
	}[];
	const tarball = join(tmpdir(), filename);
	mkdirSync(folder, { recursive: true });
	processRun({
		command: "tar",
		args: ["-xzf", tarball, "-C", folder, "--strip-components=1"],
		options: { inherit: true },
	});
	rmSync(tarball);
};
