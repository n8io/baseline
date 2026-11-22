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
	release
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
export const renameStepsApply = ({
	files,
	steps,
}: {
	files: TemplateFile[];
	steps: RenameStep[];
}): TemplateFile[] => {
	const identifiers = Object.assign(
		{},
		...steps.map((s) => s.identifiers ?? {}),
	);
	const modules = Object.assign({}, ...steps.map((s) => s.modules ?? {}));
	const names = Object.keys(identifiers) as string[];
	const paths = Object.keys(modules) as string[];
	return files
		.filter((file) => sourceIs(file.path))
		.map((file) => {
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
			return { before: file.text, file: { ...file, text } };
		})
		.filter(({ before, file }) => file.text !== before)
		.map(({ file }) => file);
};

// The file moves of every step, oldest first, for the paths the Project still has.
export const renameFilesPlan = ({
	has,
	steps,
}: {
	has: (path: string) => boolean;
	steps: RenameStep[];
}): { from: string; to: string }[] =>
	steps.flatMap((step) =>
		Object.entries(step.files ?? {})
			.filter(([from, to]) => has(from) && !has(to))
			.map(([from, to]) => ({ from, to })),
	);
