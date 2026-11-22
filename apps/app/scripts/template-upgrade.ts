// pnpm template-upgrade [--to <version>]: renders the Project's Template release and the new one
// with the saved answers, stores both as commits and cherry-picks the difference without
// committing: a 3-way merge that leaves standard conflict markers and exits 1 on a conflict.
import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { argsParse } from "./args.ts";
import { conflictOwnLines } from "./conflict-report.ts";
import { contextMapKeep } from "./context-map-keep.ts";
import { npmTarballsWait } from "./npm-tarballs-wait.ts";
import {
	type Piece,
	pieceSign,
	pieces,
	piecesRemovedFind,
	piecesRemoveFromTree,
} from "./pieces.ts";
import { gitRun, processRun } from "./process-run.ts";
import {
	releaseKey,
	renameFilesPlan,
	renameStepsApply,
	renameStepsBetween,
	renameStepsParse,
} from "./template-renames.ts";
import {
	filesRead,
	filesWrite,
	releaseLatest,
	type TemplateAnswers,
	type TemplateFile,
	templateAnswers,
	templateFetchOwn,
	templateFilesRender,
	templateFinish,
	templateJsonRead,
} from "./template-render.ts";

export type UpgradeTools = {
	fetch: (version: string) => Promise<TemplateFile[]> | TemplateFile[];
	// Formats the render and regenerates its env types; tests skip it.
	finish: (directory: string) => void;
};

// Stores a rendered tree as a commit in the Project's repository, without touching its index.
const renderCommit = ({
	files,
	message,
	parent,
	removed,
	repository,
	tools,
}: {
	files: TemplateFile[];
	message: string;
	parent?: string | null;
	// The Pieces the Project removed; the render drops them too.
	removed: Piece[];
	repository: string;
	tools: UpgradeTools;
}): string => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-render-"));
	const tree = join(work.path, "tree");
	filesWrite(tree, files);
	piecesRemoveFromTree(tree, removed);
	tools.finish(tree);
	const env = { ...process.env, GIT_INDEX_FILE: join(work.path, "index") };
	// Unlike gitRun, it works on the Project's repository with the rendered tree as its work tree
	// and a private index, so the Project's own index and files stay as they are.
	const treeGitRun = (args: string[]) =>
		processRun({
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
	treeGitRun(["add", "--all", "--force", "."]);
	const treeId = treeGitRun(["write-tree"]);
	return treeGitRun([
		"commit-tree",
		treeId,
		"-m",
		message,
		...(parent === undefined || parent === null ? [] : ["-p", parent]),
	]);
};

// The paths git left unmerged after the cherry-pick.
const conflictsRead = (repository: string): string[] =>
	gitRun(repository, ["diff", "--name-only", "--diff-filter=U"])
		.split("\n")
		.filter((path) => path !== "");

// Applies the change between two renders to the Project's working tree.
const templateMerge = ({
	from,
	labels,
	removed,
	repository,
	to,
	tools,
}: {
	from: TemplateFile[];
	labels: { from: string; to: string };
	removed: Piece[];
	repository: string;
	to: TemplateFile[];
	tools: UpgradeTools;
}): { conflicts: string[] } => {
	const base = renderCommit({
		repository,
		files: from,
		removed,
		tools,
		message: `template ${labels.from}`,
	});
	const next = renderCommit({
		repository,
		files: to,
		removed,
		tools,
		message: `template ${labels.to}`,
		parent: base,
	});
	try {
		// A conflict is reported below; gitRun keeps git's own "could not apply" hints quiet.
		gitRun(repository, ["cherry-pick", "--no-commit", next]);
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
	const sections = changelog
		.split(/^(?=## )/m)
		.filter((s) => s.startsWith("## "));
	return sections
		.filter((section) => {
			const version = /^## (\d+\.\d+\.\d+)/.exec(section)?.[1];
			if (version === undefined) return false;
			const key = releaseKey(version);
			return key > releaseKey(from) && key <= releaseKey(to);
		})
		.join("")
		.trim();
};

// Renders a release with that release's own render code, so a Project's older scripts never
// misread a newer Template. app@1.0.0, the one release without scripts/, uses this file's;
// delete that fallback once no Project upgrades from app@1.0.0.
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
// under a day old; once the Template brings its own list, the merge holds the key twice.
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

// A Project from before each context had its own CONTEXT.md keeps its terms under CONTEXT.md's
// `## Language`, which the Template no longer has. Both renders carry that section as the Project
// has it, so the merge leaves it in place instead of conflicting with it; glossary-check's test
// then fails until the Project moves each term into its context's CONTEXT.md. Delete this once
// every Project is on app@12.0.0 or later.
export const languageKeep = ({
	files,
	project,
}: {
	files: TemplateFile[];
	project: string;
}): TemplateFile[] => {
	const heading = /^## Language\s*$/m;
	const at = project.search(heading);
	if (at === -1 || !/^\*\*.+\*\*:\s*$/m.test(project.slice(at))) return files;
	const section = project.slice(at);
	return files.map((file) => {
		if (file.path !== "CONTEXT.md") return file;
		const own = file.text.search(heading);
		const head = own === -1 ? file.text : file.text.slice(0, own);
		return { ...file, text: `${head.trimEnd()}\n\n${section}` };
	});
};

const dependencyFields = [
	"dependencies",
	"devDependencies",
	"optionalDependencies",
	"peerDependencies",
] as const;

// The packages a package.json asks for, with their ranges.
const dependenciesRead = (text: string): Record<string, string> => {
	try {
		const manifest = JSON.parse(text) as Partial<
			Record<(typeof dependencyFields)[number], Record<string, string>>
		>;
		return Object.assign({}, ...dependencyFields.map((f) => manifest[f] ?? {}));
	} catch {
		return {};
	}
};

const importRoots = ["src/", "test/", "scripts/", "clients/"];
const importPattern =
	/(?:^\s*(?:import|export)\b[^;"']*?\bfrom\s*|^\s*import\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"'.#/][^"']*)["']/gm;

const importFileIs = (file: TemplateFile): boolean =>
	importRoots.some((root) => file.path.startsWith(root)) &&
	/\.[cm]?[jt]sx?$/.test(file.path);

export type DroppedImport = { name: string; paths: string[]; range: string };

// A dependency the merge took out of package.json (the Template stopped using it) that the
// Project's own code still imports. The merge applies a removal the Project never touched without
// a conflict, so the next install would prune a package the Project still needs.
export const droppedImportsFind = ({
	after,
	before,
	files,
}: {
	after: string;
	before: string;
	files: TemplateFile[];
}): DroppedImport[] => {
	const were = dependenciesRead(before);
	const are = dependenciesRead(after);
	const dropped = Object.keys(were).filter((name) => !(name in are));
	const importers = new Map<string, Set<string>>();
	for (const file of files) {
		if (!importFileIs(file)) continue;
		for (const [, specifier = ""] of file.text.matchAll(importPattern)) {
			const [scope = "", name] = specifier.split("/");
			const pack = scope.startsWith("@") ? `${scope}/${name ?? ""}` : scope;
			if (dropped.includes(pack)) {
				importers.set(pack, (importers.get(pack) ?? new Set()).add(file.path));
			}
		}
	}
	return [...importers].map(([name, paths]) => ({
		name,
		paths: [...paths].sort(),
		range: were[name] ?? "",
	}));
};

const sdkGeneratedPaths = ["clients/sdk/openapi.json", "clients/sdk/sdk.ts"];

// A Piece whose package (or folder) the Project's own release did not have yet is new, not removed: it arrives.
const pieceInRelease = (files: TemplateFile[]) => {
	const manifest = JSON.parse(
		files.find((f) => f.path === "package.json")?.text ?? "{}",
	) as Record<string, Record<string, string> | undefined>;
	const names = new Set([
		...Object.keys(manifest["dependencies"] ?? {}),
		...Object.keys(manifest["devDependencies"] ?? {}),
	]);
	return (piece: Piece) => {
		const { folder } = pieces[piece];
		return folder === undefined
			? names.has(pieceSign(piece))
			: files.some((f) => f.path.startsWith(`${folder}/`));
	};
};

// A Piece that must go before a removed one (the cli before the sdk) cannot arrive without it.
const piecesRemovedWith = (removed: Piece[]): Piece[] => [
	...new Set([
		...removed,
		...removed.flatMap((piece) => pieces[piece].after ?? []),
	]),
];

// Applies the renames the target release lists, after the merge, to the Project's own files:
// moves its files, then renames the names and import paths its code uses.
const renamesFollow = ({
	appDirectory,
	from,
	text,
	to,
}: {
	appDirectory: string;
	from: string;
	text: string;
	to: string;
}): string[] => {
	const steps = renameStepsBetween({
		from,
		to,
		steps: renameStepsParse(text),
	});
	if (steps.length === 0) return [];
	const moves = renameFilesPlan({
		has: (path) => existsSync(join(appDirectory, path)),
		steps,
	});
	for (const { from: old, to: next } of moves) {
		mkdirSync(dirname(join(appDirectory, next)), { recursive: true });
		renameSync(join(appDirectory, old), join(appDirectory, next));
	}
	const changed = renameStepsApply({
		files: filesRead(appDirectory),
		steps,
	});
	for (const file of changed)
		writeFileSync(join(appDirectory, file.path), file.text);
	return [
		...new Set([...moves.map((m) => m.to), ...changed.map((f) => f.path)]),
	].sort();
};

export const templateUpgrade = async ({
	appDirectory,
	to,
	tools,
}: {
	appDirectory: string;
	to: string;
	tools: UpgradeTools;
}): Promise<{
	conflicts: string[];
	changelog: string;
	dropped: DroppedImport[];
	/** Per conflicted file, the lines only the Project's side has. */
	lost: { lines: string[]; path: string }[];
	/** The files the Template's renames changed in the Project's own code. */
	renamed: string[];
}> => {
	const status = gitRun(appDirectory, ["status", "--porcelain"]);
	if (status.trim() !== "") {
		throw new Error("the working tree has changes; commit or stash them first");
	}
	const template = templateJsonRead(appDirectory);
	const answers: TemplateAnswers = templateAnswers(appDirectory, template);
	const fromFiles = await tools.fetch(template.release);
	const toFiles = await tools.fetch(to);
	// The Project's lockfile is its own after app-create: its next install moves only what changed.
	// So are the SDK's generated files once it has them: pnpm sdk-generate writes them from its API.
	const sdkOwn = existsSync(join(appDirectory, "clients/sdk/openapi.json"));
	const merged = (files: TemplateFile[]) =>
		files.filter(
			(f) =>
				f.path !== "pnpm-lock.yaml" &&
				!(sdkOwn && sdkGeneratedPaths.includes(f.path)),
		);
	const envPath = join(appDirectory, ".env.development");
	const project = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
	const glossaryPath = join(appDirectory, "CONTEXT.md");
	const glossary = existsSync(glossaryPath)
		? readFileSync(glossaryPath, "utf8")
		: "";
	const kept = async (files: TemplateFile[]) =>
		languageKeep({
			files: secretKeep({
				files: await releaseRender(merged(files), answers),
				project,
			}),
			project: glossary,
		});
	const contextMapPath = join(appDirectory, "CONTEXT-MAP.md");
	const renders = contextMapKeep({
		from: await kept(fromFiles),
		to: await kept(toFiles),
		project: existsSync(contextMapPath)
			? readFileSync(contextMapPath, "utf8")
			: "",
	});
	const manifestPath = join(appDirectory, "package.json");
	const manifestBefore = readFileSync(manifestPath, "utf8");
	const { conflicts } = templateMerge({
		repository: appDirectory,
		from: renders.from,
		to: renders.to,
		tools,
		removed: piecesRemovedWith(
			piecesRemovedFind(appDirectory).filter(pieceInRelease(fromFiles)),
		),
		labels: { from: template.release, to },
	});
	const workspace = join(appDirectory, "pnpm-workspace.yaml");
	if (conflicts.length === 0 && existsSync(workspace)) {
		const text = readFileSync(workspace, "utf8");
		writeFileSync(workspace, workspaceExcludesDedupe(text));
	}
	const renamed = renamesFollow({
		appDirectory,
		from: template.release,
		text: toFiles.find((f) => f.path === "template-renames.json")?.text ?? "",
		to,
	});
	const dropped =
		conflicts.length === 0
			? droppedImportsFind({
					before: manifestBefore,
					after: readFileSync(manifestPath, "utf8"),
					files: filesRead(appDirectory).filter(importFileIs),
				})
			: [];
	writeFileSync(
		join(appDirectory, ".template.json"),
		`${JSON.stringify({ ...template, release: to }, null, "\t")}\n`,
	);
	const changelog = toFiles.find((f) => f.path === "CHANGELOG.md")?.text ?? "";
	return {
		changelog: changelogBetween({ changelog, from: template.release, to }),
		conflicts,
		dropped,
		lost: conflicts
			.filter((path) => existsSync(join(appDirectory, path)))
			.map((path) => ({
				path,
				lines: conflictOwnLines(readFileSync(join(appDirectory, path), "utf8")),
			}))
			.filter(({ lines }) => lines.length > 0),
		renamed,
	};
};

// The CLI's steps after parsing; returns the exit code.
export const templateUpgradeRun = async ({
	appDirectory,
	output,
	pnpm,
	tarballsWait,
	to,
	tools,
}: {
	appDirectory: string;
	/** Where the messages go; the console when left out. */
	output?: {
		error: (line: string) => void;
		log: (line: string) => void;
	} | null;
	pnpm: (args: string[]) => void;
	/** Resolves once npm serves every @n8io/baseline-* tarball the lockfile names. */
	tarballsWait: () => Promise<void>;
	to: string;
	tools: UpgradeTools;
}): Promise<number> => {
	const { error: logError, log } = output ?? console;
	let result: Awaited<ReturnType<typeof templateUpgrade>>;
	try {
		if (templateJsonRead(appDirectory).release === to) {
			log(`template-upgrade: already on release ${to}; nothing to upgrade`);
			return 0;
		}
		result = await templateUpgrade({ appDirectory, to, tools });
	} catch (error) {
		logError(`template-upgrade: ${(error as Error).message}`);
		return 1;
	}
	log(
		`Template changes up to ${to} (apply foo changes to your contexts by hand):\n\n${result.changelog || "(no changelog entries)"}\n`,
	);
	if (result.renamed.length > 0) {
		log(
			`template-upgrade: followed the Template's renames in ${result.renamed.length} of your files:\n${result.renamed.map((path) => `  ${path}`).join("\n")}\n`,
		);
	}
	if (result.conflicts.length > 0) {
		// The format step below never runs, so give .template.json Biome's layout now; the files
		// with conflict markers cannot be formatted until they are resolved. A conflict in
		// biome.json or package.json stops Biome too: then the message asks for pnpm format.
		let steps = "pnpm install, pnpm check and pnpm test";
		try {
			pnpm(["exec", "biome", "format", "--write", ".template.json"]);
		} catch {
			steps = "pnpm install, pnpm format, pnpm check and pnpm test";
		}
		const lost = result.lost
			.map(
				({ lines, path }) =>
					`  ${path}:\n${lines
						.slice(0, 8)
						.map((line) => `    ${line.trim()}`)
						.join(
							"\n",
						)}${lines.length > 8 ? `\n    (${lines.length - 8} more)` : ""}`,
			)
			.join("\n");
		logError(
			`template-upgrade: conflicts in ${result.conflicts.join(", ")}. The merge is left staged in your working tree (nothing is committed, and .template.json has moved), so do not run template-upgrade again: resolve the markers in each file, then run ${steps}, then commit.${lost === "" ? "" : `\nYour side has these lines the Template's side lacks; keep each one you still want:\n${lost}\n`} If the install answers 404 for an @n8io/baseline-* tarball, npm is still publishing the release: wait a few minutes and run it again.`,
		);
		return 1;
	}
	if (result.dropped.length > 0) {
		logError(
			`template-upgrade: merged, but the Template dropped ${result.dropped.length === 1 ? "a dependency" : "dependencies"} your code still imports, and the install would prune ${result.dropped.length === 1 ? "it" : "them"}:\n${result.dropped.map(({ name, paths }) => `  ${name} (${paths.join(", ")})`).join("\n")}\nPut each back: \`pnpm add ${result.dropped.map(({ name, range }) => `${name}@${range}`).join(" ")}\`, and its line in dependencies-allowed.json (the Template's removal took that out too). Then run pnpm install, pnpm format, pnpm check and pnpm test. .template.json has moved, so running template-upgrade again does nothing.`,
		);
		return 1;
	}
	// The merge can pin a release published minutes ago, whose tarball npm answers 404 for
	// first: resolve the lockfile, wait for the tarballs, then install.
	try {
		pnpm(["install", "--lockfile-only"]);
		await tarballsWait();
	} catch (error) {
		logError(
			`template-upgrade: merged, but the install could not start: ${(error as Error).message}\nThe merge is done and .template.json has moved, so running template-upgrade again does nothing. Run pnpm install, pnpm format, pnpm check and pnpm test yourself.`,
		);
		return 1;
	}
	try {
		for (const script of ["install", "format", "check", "test"]) pnpm([script]);
	} catch {
		logError("template-upgrade: merged, but format, typecheck or tests fail");
		return 1;
	}
	log("template-upgrade: merged; review the changes and commit them");
	return 0;
};

const usage = `Usage: pnpm template-upgrade [--to <version>]

Renders the Project's Template release and the new one, and merges the difference into the working
tree without committing. Exits 1 on a conflict.

  --to <version>  the release to upgrade to (default: the latest)
  -h, --help      this help`;

const main = async () => {
	const parsed = argsParse({ options: { to: { type: "string" } }, usage });
	if (parsed === undefined) return;
	const { values } = parsed;
	const appDirectory = process.cwd();
	process.exitCode = await templateUpgradeRun({
		appDirectory,
		to: values.to ?? releaseLatest(),
		tools: {
			fetch: (version) => templateFetchOwn(version),
			finish: (directory) => templateFinish(directory, appDirectory),
		},
		pnpm: (args) => {
			processRun({
				command: "pnpm",
				args,
				options: { cwd: appDirectory, inherit: true },
			});
		},
		tarballsWait: () => npmTarballsWait({ directory: appDirectory }),
	});
};

if (import.meta.main) await main();
