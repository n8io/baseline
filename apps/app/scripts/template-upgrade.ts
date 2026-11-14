// pnpm template-upgrade [--to <version>]: renders the project's template release and the new one
// with the saved answers, stores both as commits and cherry-picks the difference without
// committing: a 3-way merge that leaves standard conflict markers and exits 1 on a conflict.
import {
	existsSync,
	mkdtempDisposableSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
const renderCommit = ({
	files,
	message,
	parent,
	repository,
	tools,
}: {
	files: TemplateFile[];
	message: string;
	parent?: string;
	repository: string;
	tools: UpgradeTools;
}): string => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-render-"));
	const tree = join(work.path, "tree");
	filesWrite(tree, files);
	tools.finish(tree);
	const env = { ...process.env, GIT_INDEX_FILE: join(work.path, "index") };
	const git = (args: string[]) =>
		run({
			command: "git",
			args: [
				"--git-dir",
				join(repository, ".git"),
				"--work-tree",
				tree,
				...args,
			],
			options: {
				cwd: tree,
				env,
			},
		}).trim();
	git(["add", "--all", "--force", "."]);
	const treeId = git(["write-tree"]);
	return git([
		"commit-tree",
		treeId,
		"-m",
		message,
		...(parent === undefined ? [] : ["-p", parent]),
	]);
};

// The paths git left unmerged after the cherry-pick.
const conflictsRead = (repository: string): string[] =>
	run({
		command: "git",
		args: ["diff", "--name-only", "--diff-filter=U"],
		options: { cwd: repository },
	})
		.split("\n")
		.filter((path) => path !== "");

// Applies the change between two renders to the project's working tree.
const templateMerge = ({
	from,
	labels,
	repository,
	to,
	tools,
}: {
	from: TemplateFile[];
	labels: { from: string; to: string };
	repository: string;
	to: TemplateFile[];
	tools: UpgradeTools;
}): { conflicts: string[] } => {
	const base = renderCommit({
		repository,
		files: from,
		tools,
		message: `template ${labels.from}`,
	});
	const next = renderCommit({
		repository,
		files: to,
		tools,
		message: `template ${labels.to}`,
		parent: base,
	});
	try {
		run({
			command: "git",
			args: ["cherry-pick", "--no-commit", next],
			// A conflict is reported below; git's own "could not apply" hints would repeat it.
			options: { cwd: repository, quiet: true },
		});
	} catch (error) {
		// A conflict exits non-zero and leaves unmerged paths; anything else is a real failure.
		const conflicts = conflictsRead(repository);
		if (conflicts.length === 0) throw error;
		return { conflicts };
	}
	return { conflicts: [] };
};

// The `## <version>` sections of the app's changelog after `from`, up to and including `to`.
export const changelogBetween = ({
	changelog,
	from,
	to,
}: {
	changelog: string;
	from: string;
	to: string;
}): string => {
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

// Renders a release with that release's own render code, so a project's older scripts never
// misread a newer template. Releases without scripts/ use this file's.
export const releaseRender = async (
	files: TemplateFile[],
	answers: TemplateAnswers,
): Promise<TemplateFile[]> => {
	const own = files.find((f) => f.path === "scripts/template-render.ts");
	if (own === undefined) return templateFilesRender(files, answers);
	using work = mkdtempDisposableSync(join(tmpdir(), "template-render-code-"));
	const path = join(work.path, "template-render.ts");
	writeFileSync(path, own.text);
	const module = (await import(pathToFileURL(path).href)) as {
		templateFilesRender: typeof templateFilesRender;
	};
	return module.templateFilesRender(files, answers);
};

// pnpm writes its own minimumReleaseAgeExclude of exact @n8io/baseline-* versions when they are
// under a day old; once the template brings its own list, the merge holds the key twice.
export const workspaceExcludesDedupe = (workspace: string): string => {
	const pnpmList =
		/^minimumReleaseAgeExclude:\n(?: {2}- "@n8io\/baseline-[^"@]+@[^"]+"\n)+/m;
	if (workspace.match(/^minimumReleaseAgeExclude:/gm)?.length !== 2)
		return workspace;
	return workspace.replace(pnpmList, "");
};

// app-create gives each Project its own AUTHN_SECRET. Both renders carry the Project's, so a change
// to a neighbouring line of .env.development merges instead of conflicting with it.
export const secretKeep = ({
	files,
	project,
}: {
	files: TemplateFile[];
	project: string;
}): TemplateFile[] => {
	const secret = /^AUTHN_SECRET=.*$/m.exec(project)?.[0];
	if (secret === undefined) return files;
	return files.map((file) =>
		file.path === ".env.development"
			? { ...file, text: file.text.replace(/^AUTHN_SECRET=.*$/m, () => secret) }
			: file,
	);
};

export const templateUpgrade = async ({
	appDirectory,
	to,
	tools,
}: {
	appDirectory: string;
	to: string;
	tools: UpgradeTools;
}): Promise<{ conflicts: string[]; changelog: string }> => {
	const status = run({
		command: "git",
		args: ["status", "--porcelain"],
		options: { cwd: appDirectory },
	});
	if (status.trim() !== "") {
		throw new Error("the working tree has changes; commit or stash them first");
	}
	const template = templateJsonRead(appDirectory);
	const answers: TemplateAnswers = templateAnswers(appDirectory, template);
	const fromFiles = tools.fetch(template.release);
	const toFiles = tools.fetch(to);
	// The project's lockfile is its own after app-create: its next install moves only what changed.
	const merged = (files: TemplateFile[]) =>
		files.filter((f) => f.path !== "pnpm-lock.yaml");
	const envPath = join(appDirectory, ".env.development");
	const project = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
	const { conflicts } = templateMerge({
		repository: appDirectory,
		from: secretKeep({
			files: await releaseRender(merged(fromFiles), answers),
			project,
		}),
		to: secretKeep({
			files: await releaseRender(merged(toFiles), answers),
			project,
		}),
		tools,
		labels: { from: template.release, to },
	});
	const workspace = join(appDirectory, "pnpm-workspace.yaml");
	if (conflicts.length === 0 && existsSync(workspace)) {
		const text = readFileSync(workspace, "utf8");
		writeFileSync(workspace, workspaceExcludesDedupe(text));
	}
	writeFileSync(
		join(appDirectory, ".template.json"),
		`${JSON.stringify({ ...template, release: to }, null, "\t")}\n`,
	);
	const changelog = toFiles.find((f) => f.path === "CHANGELOG.md")?.text ?? "";
	return {
		changelog: changelogBetween({ changelog, from: template.release, to }),
		conflicts,
	};
};

// The CLI's steps after parsing; returns the exit code.
export const templateUpgradeRun = async ({
	appDirectory,
	pnpm,
	to,
	tools,
}: {
	appDirectory: string;
	pnpm: (script: string) => void;
	to: string;
	tools: UpgradeTools;
}): Promise<number> => {
	let result: { conflicts: string[]; changelog: string };
	try {
		result = await templateUpgrade({ appDirectory, to, tools });
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

const main = async () => {
	const { values } = parseArgs({ options: { to: { type: "string" } } });
	const appDirectory = process.cwd();
	process.exitCode = await templateUpgradeRun({
		appDirectory,
		to: values.to ?? releaseLatest(),
		tools: {
			fetch: (version) => templateFetch(version),
			finish: (directory) => templateFinish(directory, appDirectory),
		},
		pnpm: (script) => {
			run({
				command: "pnpm",
				args: [script],
				options: { cwd: appDirectory, inherit: true },
			});
		},
	});
};

if (import.meta.main) await main();
