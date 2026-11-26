// Fetching a release and exporting apps/app from a baseline checkout.
import {
	existsSync,
	mkdirSync,
	mkdtempDisposableSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { processRun } from "./template-render-process.ts";
import { filesRead } from "./template-render-tree.ts";
import {
	type TemplateAnswers,
	type TemplateFile,
	templateRepository,
} from "./template-render-types.ts";

const releaseTag = (version: string): string => `app@${version}`;

export const releaseLatest = (): string => {
	const tags = processRun({
		command: "git",
		args: [
			"ls-remote",
			"--tags",
			"--refs",
			`https://github.com/${templateRepository}.git`,
			"app@*",
		],
	});
	const versions = [...tags.matchAll(/refs\/tags\/app@(\d+)\.(\d+)\.(\d+)$/gm)]
		.map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const)
		.filter(([major]) => major > 0)
		.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
	const latest = versions.at(-1);
	if (latest === undefined)
		throw new Error(`No app@ release in ${templateRepository}`);
	return latest.join(".");
};

// The Template's own workspace settings, which the monorepo root holds for apps/app. A Project's
// root is the app, and clients/ holds the packages made from its API.
export const workspaceRender = (rootWorkspace: string): string =>
	rootWorkspace.replace(
		/^packages:\n(?: {2}- .*\n)*/m,
		[
			"# piece-start: sdk",
			"# The root is the app; clients/ holds the packages made from its API.",
			"packages:",
			'  - "."',
			"  - clients/*",
			"# `pnpm add` in the root adds to the app, as in a Project without clients.",
			"ignoreWorkspaceRootCheck: true",
			"# piece-end: sdk",
			"",
		].join("\n"),
	);

// The Template's own lockfile: the root lockfile with apps/app as the only importer, so a Project
// installs the versions the release was tested with instead of resolving its ranges fresh, which
// minimumReleaseAge can refuse on the day a dependency ships. The workspace links are dropped and
// resolve from npm, exempt from the age check; the first install prunes what apps/app never used.
export const lockfileRender = (rootLockfile: string): string => {
	// pnpm writes its own install in a first YAML document; the dependencies are in the last.
	const documents = rootLockfile.split(/^(?=---\n)/m);
	const last = documents.at(-1) ?? "";
	const app = /^ {2}apps\/app:\n((?: {4}.*\n)+)/m.exec(last)?.[1];
	const importers = /^importers:\n\n[\s\S]*?\n(?=packages:\n)/m;
	if (app === undefined || !importers.test(last)) {
		throw new Error("the root lockfile has no apps/app importer");
	}
	const dependencies = app.replace(
		/^ {6}\S.*:\n {8}specifier: .*\n {8}version: link:.*\n/gm,
		"",
	);
	const own = last.replace(importers, `importers:\n\n  .:\n${dependencies}\n`);
	return [...documents.slice(0, -1), own].join("");
};

// A manifest under clients/ with its `workspace:^` ranges on our own packages as `pnpm pack` writes
// them, `^` and the version in `versions`; a Project installs those packages from npm.
export const clientManifestPin = (
	text: string,
	versions: Record<string, string>,
): string => {
	const manifest = JSON.parse(text) as Partial<
		Record<"dependencies" | "devDependencies", Record<string, string>>
	>;
	for (const field of ["dependencies", "devDependencies"] as const) {
		for (const [name, range] of Object.entries(manifest[field] ?? {})) {
			if (
				!name.startsWith("@n8io/baseline-") ||
				!range.startsWith("workspace:")
			) {
				continue;
			}
			const version = versions[name];
			if (version === undefined) throw new Error(`no package is ${name}`);
			if (range !== "workspace:^") {
				throw new Error(`${name}: use workspace:^, not ${range}`);
			}
			manifest[field] = { ...manifest[field], [name]: `^${version}` };
		}
	}
	return `${JSON.stringify(manifest, null, "\t")}\n`;
};

// Exports apps/app at `ref` of a baseline checkout: files with `git archive`, package.json from
// `pnpm pack` (workspace:^ becomes a caret range; pnpm pack writes a lockfile, so use a throwaway
// checkout), the clients' manifests from clientManifestPin, pnpm-workspace.yaml from the root and
// pnpm-lock.yaml from lockfileRender. Returns the unrendered files, foo included.
export const templateExport = (
	checkout: string,
	ref: string,
): TemplateFile[] => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-export-"));
	const app = join(work.path, "app");
	mkdirSync(app);
	const archive = join(work.path, "app.tar");
	processRun({
		command: "git",
		args: ["archive", "--output", archive, `${ref}:apps/app`],
		options: {
			cwd: checkout,
		},
	});
	processRun({ command: "tar", args: ["-xf", archive, "-C", app] });
	const packed = join(work.path, "packed");
	mkdirSync(packed);
	processRun({
		command: "pnpm",
		args: ["pack", "--pack-destination", packed],
		options: {
			cwd: join(checkout, "apps/app"),
		},
	});
	const tarball = readdirSync(packed).find((f) => f.endsWith(".tgz"));
	if (tarball === undefined) throw new Error("pnpm pack wrote no tarball");
	processRun({
		command: "tar",
		args: ["-xzf", join(packed, tarball), "-C", packed, "package/package.json"],
	});
	// pnpm pack drops packageManager, which CI's pnpm setup reads.
	const manifest = JSON.parse(
		readFileSync(join(packed, "package/package.json"), "utf8"),
	) as Record<string, unknown>;
	const { packageManager } = JSON.parse(
		readFileSync(join(checkout, "apps/app/package.json"), "utf8"),
	) as { packageManager: string };
	writeFileSync(
		join(app, "package.json"),
		`${JSON.stringify({ ...manifest, packageManager }, null, "\t")}\n`,
	);
	const versions = Object.fromEntries(
		readdirSync(join(checkout, "packages")).map((folder) => {
			const { name, version } = JSON.parse(
				readFileSync(
					join(checkout, "packages", folder, "package.json"),
					"utf8",
				),
			) as { name: string; version: string };
			return [name, version];
		}),
	);
	const clients = join(app, "clients");
	for (const client of existsSync(clients) ? readdirSync(clients) : []) {
		const path = join(clients, client, "package.json");
		if (existsSync(path)) {
			writeFileSync(
				path,
				clientManifestPin(readFileSync(path, "utf8"), versions),
			);
		}
	}
	writeFileSync(
		join(app, "pnpm-workspace.yaml"),
		workspaceRender(
			readFileSync(join(checkout, "pnpm-workspace.yaml"), "utf8"),
		),
	);
	writeFileSync(
		join(app, "pnpm-lock.yaml"),
		lockfileRender(readFileSync(join(checkout, "pnpm-lock.yaml"), "utf8")),
	);
	return filesRead(app);
};

// Exports with the release's own templateExport, as releaseRender renders with its own render code:
// the Project's copy of this file is the old release's, so a release's change to the export (the
// sdk workspace block, the client pins) would otherwise never reach the Project. A checkout whose
// scripts/ lacks the file or the function (app@1.0.0) uses this file's.
export const templateExportOwn = async (
	checkout: string,
	ref: string,
): Promise<TemplateFile[]> => {
	const own = join(checkout, "apps/app/scripts/template-render.ts");
	if (!existsSync(own)) return templateExport(checkout, ref);
	const loaded = (await import(pathToFileURL(own).href)) as {
		templateExport?: typeof templateExport;
	};
	return (loaded.templateExport ?? templateExport)(checkout, ref);
};

// Clones the release (blobless) into `work`.
const releaseClone = (work: string, version: string): string => {
	const clone = join(work, "clone");
	processRun({
		command: "git",
		args: [
			"-c",
			"advice.detachedHead=false",
			"clone",
			"--quiet",
			"--filter=blob:none",
			"--branch",
			releaseTag(version),
			`https://github.com/${templateRepository}.git`,
			clone,
		],
	});
	return clone;
};

// Exports a release's apps/app with this file's templateExport, then removes the clone.
export const templateFetch = (version: string): TemplateFile[] => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-"));
	return templateExport(releaseClone(work.path, version), releaseTag(version));
};

// Exports it with the release's own templateExport (templateExportOwn).
export const templateFetchOwn = async (
	version: string,
): Promise<TemplateFile[]> => {
	using work = mkdtempDisposableSync(join(tmpdir(), "template-"));
	return await templateExportOwn(
		releaseClone(work.path, version),
		releaseTag(version),
	);
};

export const appIsMonorepo = (appDirectory: string): boolean =>
	existsSync(join(appDirectory, "../../packages/result/package.json")) &&
	!existsSync(join(appDirectory, ".template.json"));

type TemplateJson = { release: string; description: string };

export const templateJsonRead = (appDirectory: string): TemplateJson =>
	JSON.parse(
		readFileSync(join(appDirectory, ".template.json"), "utf8"),
	) as TemplateJson;

export const templateAnswers = (
	appDirectory: string,
	template: TemplateJson,
): TemplateAnswers => {
	const manifest = JSON.parse(
		readFileSync(join(appDirectory, "package.json"), "utf8"),
	) as { name: string };
	return {
		description: template.description,
		name: manifest.name,
	};
};
