import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A file that outgrows its limit is split into modules, one per concern, with the entry point
// keeping its name. Source files hold to 400 lines; scripts, which read top to bottom as a
// command's steps, to 500. Tests, declaration files, node_modules and dist are not counted.
const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceLimit = 400;
const scriptLimit = 500;

// A file that cannot reasonably be split, by its path from the repository root, with the reason.
// Keep it empty unless splitting the file would make it worse.
const exemptions: readonly { path: string; reason: string }[] = [];

type Limited = { limit: number; path: string };

const filesIn = (folder: string): string[] =>
	readdirSync(path.join(repoRoot, folder), {
		recursive: true,
		withFileTypes: true,
	})
		.filter((entry) => entry.isFile())
		.map((entry) =>
			path
				.relative(repoRoot, path.join(entry.parentPath, entry.name))
				.split(path.sep)
				.join("/"),
		)
		.filter(
			(name) =>
				/\.tsx?$/.test(name) &&
				!name.endsWith(".d.ts") &&
				!/\.test\.tsx?$/.test(name) &&
				!/(^|\/)(node_modules|dist)\//.test(name),
		);

const childrenOf = (folder: string): string[] =>
	readdirSync(path.join(repoRoot, folder), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `${folder}/${entry.name}`);

const limitedRead = (): Limited[] => [
	...[...childrenOf("packages"), ...childrenOf("apps")].flatMap((root) =>
		filesIn(`${root}/src`).map((name) => ({ limit: sourceLimit, path: name })),
	),
	...[
		"scripts",
		...childrenOf("apps").map((root) => `${root}/scripts`),
	].flatMap((root) =>
		filesIn(root).map((name) => ({ limit: scriptLimit, path: name })),
	),
];

const linesOf = (name: string): number => {
	const text = readFileSync(path.join(repoRoot, name), "utf8");
	return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
};

describe("file length", () => {
	it("keeps every source file under 400 lines and every script under 500", () => {
		const files = limitedRead().filter(
			({ path: name }) => !exemptions.some((e) => e.path === name),
		);
		expect(files.length).toBeGreaterThan(100);
		expect(
			files
				.map((file) => ({ ...file, lines: linesOf(file.path) }))
				.filter(({ limit, lines }) => lines > limit)
				.map(
					({ limit, lines, path: name }) =>
						`${name}: ${lines} lines, over ${limit}; split it into modules`,
				),
		).toEqual([]);
	});

	it("lists only files that exist and give a reason", () => {
		const all = new Set(limitedRead().map((file) => file.path));
		expect(
			exemptions
				.filter((e) => !all.has(e.path) || e.reason.trim() === "")
				.map((e) => e.path),
		).toEqual([]);
	});
});
