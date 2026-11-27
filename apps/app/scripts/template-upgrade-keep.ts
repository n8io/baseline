// template-upgrade's keeps: the edits both renders get so the merge leaves what the Project owns
// alone, plus the changelog and render-code steps around them.
import { mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { pathToFileURL } from "node:url";
import { releaseKey } from "./template-renames.ts";
import {
	type TemplateAnswers,
	type TemplateFile,
	templateFilesRender,
} from "./template-render.ts";

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

const renderEntry = "scripts/template-render.ts";

// The relative modules a file imports or re-exports.
const importsRelative = (text: string): string[] =>
	[...text.matchAll(/^(?:import|export)\b[^;]*?from "(\.[^"]+)";/gms)]
		.map((match) => match[1])
		.filter((specifier): specifier is string => specifier !== undefined);

// The release's render files the entry point reaches by following relative imports, so a release
// that splits its render code (template-render-blocks.ts and the like) ships every module it needs.
export const renderModulesFollow = (files: TemplateFile[]): TemplateFile[] => {
	const byPath = new Map(files.map((file) => [file.path, file] as const));
	const reach = (path: string, found: string[]): string[] => {
		if (found.includes(path)) return found;
		const file = byPath.get(path);
		if (file === undefined) {
			throw new Error(
				`${path} is imported by the render but not in the release`,
			);
		}
		return importsRelative(file.text).reduce(
			(paths, specifier) =>
				reach(posix.join(posix.dirname(path), specifier), paths),
			[...found, path],
		);
	};
	const paths = reach(renderEntry, []);
	return files.filter((file) => paths.includes(file.path));
};

// Renders a release with that release's own render code, so a Project's older scripts never
// misread a newer Template. app@1.0.0, the one release without scripts/, uses this file's;
// delete that fallback once no Project upgrades from app@1.0.0.
export const releaseRender = async (
	files: TemplateFile[],
	answers: TemplateAnswers,
): Promise<TemplateFile[]> => {
	const own = files.find((f) => f.path === renderEntry);
	if (own === undefined) return templateFilesRender(files, answers);
	using work = mkdtempDisposableSync(join(tmpdir(), "template-render-code-"));
	for (const file of renderModulesFollow(files)) {
		writeFileSync(join(work.path, basename(file.path)), file.text);
	}
	const path = join(work.path, basename(renderEntry));
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
