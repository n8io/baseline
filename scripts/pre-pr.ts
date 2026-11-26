// Maintainer script: part of baseline's own agent workflow, never rendered into a Project.
// Checks a branch before its pull request opens, with no model: size, changeset and whether a model review is
// worth running. Usage: node scripts/pre-pr.ts [--base origin/main]
// Exit code 0: nothing failed (read the lines for warnings), 1: a check failed.
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

export type PrPreFile = { added: number; deleted: number; path: string };

export type PrPreLine = { level: "fail" | "ok" | "warn"; text: string };

// Generated or lockfile content never counts toward the size limit.
const generated = /(^|\/)(pnpm-lock\.yaml|CHANGELOG\.md)$|\.svg$/;
const sizeLimit = 1500;
const isDoc = (path: string) => path.endsWith(".md");
const isChangeset = (path: string) =>
	/^\.changeset\/(?!README).+\.md$/.test(path);
const publishes = (path: string) =>
	/^packages\/[^/]+\/src\//.test(path) &&
	!/\.test\.ts$|\.contract\.ts$/.test(path);

export const prPreCheck = (files: PrPreFile[]): PrPreLine[] => {
	const lines: PrPreLine[] = [];
	const changed = files
		.filter((f) => !generated.test(f.path))
		.reduce((sum, f) => sum + f.added + f.deleted, 0);
	lines.push(
		changed > sizeLimit
			? {
					level: "fail",
					text: `${changed} changed lines, over ${sizeLimit}: split the work`,
				}
			: { level: "ok", text: `${changed} changed lines` },
	);
	const needsChangeset = files.some((f) => publishes(f.path));
	const hasChangeset = files.some((f) => isChangeset(f.path));
	lines.push(
		needsChangeset && !hasChangeset
			? {
					level: "warn",
					text: "a Package's source changed and no changeset was added (fine only if nothing published changes)",
				}
			: { level: "ok", text: "changeset matches the change" },
	);
	const docsOnly =
		files.length > 0 &&
		files.every((f) => isDoc(f.path) || isChangeset(f.path));
	lines.push({
		level: "ok",
		text: docsOnly
			? "review: skip the model review (Markdown only)"
			: "review: run one Sonnet review after `pnpm check` and the tests pass",
	});
	return lines;
};

const filesRead = (base: string): PrPreFile[] =>
	execFileSync("git", ["diff", "--numstat", "--no-renames", `${base}...HEAD`], {
		encoding: "utf8",
	})
		.split("\n")
		.filter(Boolean)
		.map((line) => {
			const [added = "0", deleted = "0", path = ""] = line.split("\t");
			// A binary file shows `-`; it counts as no lines.
			return {
				added: Number(added) || 0,
				deleted: Number(deleted) || 0,
				path,
			};
		});

if (import.meta.main) {
	const { values } = parseArgs({
		options: { base: { default: "origin/main", type: "string" } },
	});
	const lines = prPreCheck(filesRead(values.base));
	for (const { level, text } of lines) console.log(`${level}: ${text}`);
	process.exitCode = lines.some((l) => l.level === "fail") ? 1 : 0;
}
