import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The files this test reads, so `pnpm test --changed` runs it when one changes.
import.meta.glob(["./lint-plugins/*.grit", "./lint-plugin-samples/*.txt"], {
	query: "?raw",
});

const biomeBin = createRequire(import.meta.url).resolve(
	"@biomejs/biome/bin/biome",
);
const appRoot = fileURLToPath(new URL("./", import.meta.url));
const samplesDir = path.join(appRoot, "lint-plugin-samples");

// A sample: `// <rule>: <what>`, `// expect: <part of the Biome message>` (empty: no diagnostic), then
// `// @file <path>` sections. Each runs through Biome with this app's biome.json, as `pnpm check` does.
const sampleRun = (text: string): string => {
	const directory = mkdtempSync(path.join(tmpdir(), "lint-plugin-"));
	cpSync(
		path.join(appRoot, "lint-plugins"),
		path.join(directory, "lint-plugins"),
		{
			recursive: true,
		},
	);
	// Stand-alone config: no `root: false` (this is the root) and no VCS ignore file (the directory has no git).
	const {
		root: _root,
		vcs: _vcs,
		...config
	} = JSON.parse(
		readFileSync(path.join(appRoot, "biome.json"), "utf8"),
	) as Record<string, unknown>;
	writeFileSync(path.join(directory, "biome.json"), JSON.stringify(config));
	const sections = text.split(/^\/\/ @file (\S+)\n/m).slice(1);
	for (let i = 0; i < sections.length; i += 2) {
		const file = path.join(directory, sections[i] ?? "");
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, sections[i + 1] ?? "");
	}
	try {
		return execFileSync(process.execPath, [biomeBin, "lint", "."], {
			cwd: directory,
			encoding: "utf8",
			stdio: "pipe",
		});
	} catch (error) {
		const { stderr, stdout } = error as { stderr: string; stdout: string };
		return `${stdout}${stderr}`;
	}
};

describe("lint plugins", () => {
	it.each(
		readdirSync(samplesDir)
			.filter((name) => name.endsWith(".txt"))
			.sort(),
	)(
		"sample %s",
		(name) => {
			const text = readFileSync(path.join(samplesDir, name), "utf8");
			const expected = /^\/\/ expect:[ ]?(.*)$/m.exec(text)?.[1] ?? "";
			const output = sampleRun(text);
			if (expected === "") expect(output).not.toContain("plugin");
			else expect(output).toContain(expected);
		},
		30_000,
	);
});
