// What a Template release renamed, so the upgrade can follow the rename in a Project's own code.
// The Template lists each rename in template-renames.json; the upgrade applies every entry between
// the Project's release and the target to the Project's own files after the merge.
import type { TemplateFile } from "./template-render.ts";

export type RenameStep = {
	/** File moves, old path to new path, from the app's root. */
	files?: Record<string, string>;
	/** Exported names, old to new; whole words only. */
	identifiers?: Record<string, string>;
	/** Import paths, old to new; the whole path inside the quotes. */
	modules?: Record<string, string>;
	release: string;
};

export const releaseKey = (release: string): string =>
	(release.split("-")[0] ?? release)
		.split(".")
		.map((n) => n.padStart(6, "0"))
		.join(".");

export const renameStepsBetween = ({
	from,
	steps,
	to,
}: {
	from: string;
	steps: RenameStep[];
	to: string;
}): RenameStep[] =>
	steps.filter(
		({ release }) =>
			releaseKey(release) > releaseKey(from) &&
			releaseKey(release) <= releaseKey(to),
	);

export const renameStepsParse = (text: string): RenameStep[] => {
	try {
		const parsed: unknown = JSON.parse(text);
		return Array.isArray(parsed) ? (parsed as RenameStep[]) : [];
	} catch {
		return [];
	}
};

const regexEscape = (text: string): string =>
	text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const sourceIs = (path: string): boolean =>
	["src/", "test/", "scripts/", "clients/"].some((root) =>
		path.startsWith(root),
	) && /\.[cm]?[jt]sx?$/.test(path);

// The Project's source files with every step's identifiers and import paths renamed; only the
// files that changed come back.
const renameStepApply = ({
	files,
	step,
}: {
	files: TemplateFile[];
	step: RenameStep;
}): TemplateFile[] => {
	const identifiers = step.identifiers ?? {};
	const modules = step.modules ?? {};
	const names = Object.keys(identifiers);
	const paths = Object.keys(modules);
	return files.map((file) => {
		if (!sourceIs(file.path)) return file;
		const named =
			names.length === 0
				? file.text
				: file.text.replace(
						new RegExp(
							`(?<![\\w$])(${names.map(regexEscape).join("|")})(?![\\w$])`,
							"g",
						),
						(name) => identifiers[name] ?? name,
					);
		const text =
			paths.length === 0
				? named
				: named.replace(
						new RegExp(`(["'])(${paths.map(regexEscape).join("|")})\\1`, "g"),
						(whole) => {
							const quote = whole.slice(0, 1);
							const path = whole.slice(1, -1);
							return `${quote}${modules[path] ?? path}${quote}`;
						},
					);
		return { ...file, text };
	});
};

// The Project's source files with each step's identifiers and import paths renamed, one step after
// the other so a name renamed twice follows both; only the files that changed come back.
export const renameStepsApply = ({
	files,
	steps,
}: {
	files: TemplateFile[];
	steps: RenameStep[];
}): TemplateFile[] => {
	const renamed = steps.reduce(
		(current, step) => renameStepApply({ files: current, step }),
		files,
	);
	return renamed.filter((file, at) => file.text !== files[at]?.text);
};

// The file moves of every step, oldest first, for the paths the Project still has.
export const renameFilesPlan = ({
	has,
	steps,
}: {
	has: (path: string) => boolean;
	steps: RenameStep[];
}): { from: string; to: string }[] =>
	steps.reduce<{ from: string; to: string }[]>((moves, step) => {
		const moved = new Set(moves.map((m) => m.from));
		const present = (path: string) =>
			moves.some((m) => m.to === path) || (has(path) && !moved.has(path));
		return moves.concat(
			Object.entries(step.files ?? {})
				.filter(([from, to]) => present(from) && !present(to))
				.map(([from, to]) => ({ from, to })),
		);
	}, []);
