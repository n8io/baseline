// pnpm template-upgrade [--to <version>]: renders the project's template release and the new one
// with the saved answers, stores both as commits and cherry-picks the difference without
// committing: a 3-way merge that leaves standard conflict markers and exits 1 on a conflict.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
	filesWrite,
	releaseLatest,
	run,
	type TemplateAnswers,
	type TemplateFile,
	templateAnswers,
	templateFetch,
	templateFilesRender,
	templateFinish,
	templateJsonRead,
} from "./template-render.ts";

export type UpgradeTools = {
	fetch: (version: string) => TemplateFile[];
	// Formats the render and regenerates its env types; tests skip it.
	finish: (directory: string) => void;
};

// Stores a rendered tree as a commit in the project's repository, without touching its index.
const renderCommit = (
	repository: string,
	files: TemplateFile[],
	tools: UpgradeTools,
	message: string,
	parent?: string,
): string => {
	const work = mkdtempSync(join(tmpdir(), "template-render-"));
	try {
		const tree = join(work, "tree");
		filesWrite(tree, files);
		tools.finish(tree);
		const env = { ...process.env, GIT_INDEX_FILE: join(work, "index") };
		const git = (args: string[]) =>
			run(
				"git",
				["--git-dir", join(repository, ".git"), "--work-tree", tree, ...args],
				{
					cwd: tree,
					env,
				},
			).trim();
		git(["add", "--all", "--force", "."]);
		const treeId = git(["write-tree"]);
		return git([
			"commit-tree",
			treeId,
			"-m",
			message,
			...(parent === undefined ? [] : ["-p", parent]),
		]);
	} finally {
		rmSync(work, { force: true, recursive: true });
	}
};

// The paths git left unmerged after the cherry-pick.
const conflictsRead = (repository: string): string[] =>
	run("git", ["diff", "--name-only", "--diff-filter=U"], { cwd: repository })
		.split("\n")
		.filter((path) => path !== "");

// Applies the change between two renders to the project's working tree.
export const templateMerge = (
	repository: string,
	from: TemplateFile[],
	to: TemplateFile[],
	tools: UpgradeTools,
	labels: { from: string; to: string },
): { conflicts: string[] } => {
	const base = renderCommit(repository, from, tools, `template ${labels.from}`);
	const next = renderCommit(
		repository,
		to,
		tools,
		`template ${labels.to}`,
		base,
	);
	try {
		run("git", ["cherry-pick", "--no-commit", next], { cwd: repository });
	} catch {
		// A conflict exits non-zero; the unmerged paths say so.
	}
	return { conflicts: conflictsRead(repository) };
};

// The `## <version>` sections of the app's changelog after `from`, up to and including `to`.
export const changelogBetween = (
	changelog: string,
	from: string,
	to: string,
): string => {
	const versionKey = (v: string) =>
		v
			.split(".")
			.map((n) => n.padStart(6, "0"))
			.join(".");
	const sections = changelog
		.split(/^(?=## )/m)
		.filter((s) => s.startsWith("## "));
	return sections
		.filter((section) => {
			const version = /^## (\d+\.\d+\.\d+)/.exec(section)?.[1];
			if (version === undefined) return false;
			const key = versionKey(version);
			return key > versionKey(from) && key <= versionKey(to);
		})
		.join("")
		.trim();
};

export const templateUpgrade = (
	appDirectory: string,
	to: string,
	tools: UpgradeTools,
): { conflicts: string[]; changelog: string } => {
	const status = run("git", ["status", "--porcelain"], { cwd: appDirectory });
	if (status.trim() !== "") {
		throw new Error("the working tree has changes; commit or stash them first");
	}
	const template = templateJsonRead(appDirectory);
	const answers: TemplateAnswers = templateAnswers(appDirectory, template);
	const fromFiles = tools.fetch(template.release);
	const toFiles = tools.fetch(to);
	const { conflicts } = templateMerge(
		appDirectory,
		templateFilesRender(fromFiles, answers),
		templateFilesRender(toFiles, answers),
		tools,
		{ from: template.release, to },
	);
	writeFileSync(
		join(appDirectory, ".template.json"),
		`${JSON.stringify({ ...template, release: to }, null, "\t")}\n`,
	);
	const changelog = toFiles.find((f) => f.path === "CHANGELOG.md")?.text ?? "";
	return {
		changelog: changelogBetween(changelog, template.release, to),
		conflicts,
	};
};

// The CLI's steps after parsing; returns the exit code.
export const templateUpgradeRun = (
	appDirectory: string,
	to: string,
	tools: UpgradeTools,
	pnpm: (script: string) => void,
): number => {
	let result: { conflicts: string[]; changelog: string };
	try {
		result = templateUpgrade(appDirectory, to, tools);
	} catch (error) {
		console.error(`template-upgrade: ${(error as Error).message}`);
		return 1;
	}
	console.log(
		`Template changes up to ${to} (apply foo changes to your domains by hand):\n\n${result.changelog || "(no changelog entries)"}\n`,
	);
	if (result.conflicts.length > 0) {
		console.error(
			`template-upgrade: conflicts in ${result.conflicts.join(", ")}. Resolve the markers, then run pnpm install, pnpm check and pnpm test.`,
		);
		return 1;
	}
	try {
		for (const script of ["install", "format", "check", "test"]) pnpm(script);
	} catch {
		console.error(
			"template-upgrade: merged, but format, typecheck or tests fail",
		);
		return 1;
	}
	console.log("template-upgrade: merged; review the changes and commit them");
	return 0;
};

const main = () => {
	const { values } = parseArgs({ options: { to: { type: "string" } } });
	const appDirectory = process.cwd();
	process.exitCode = templateUpgradeRun(
		appDirectory,
		values.to ?? releaseLatest(),
		{
			fetch: (version) => templateFetch(version),
			finish: (directory) => templateFinish(directory, appDirectory),
		},
		(script) => {
			run("pnpm", [script], { cwd: appDirectory, inherit: true });
		},
	);
};

if (import.meta.main) main();
