// template-upgrade's import check: the dependencies the merge dropped that the Project's code
// still imports.
import type { TemplateFile } from "./template-render.ts";

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

export const importFileIs = (file: TemplateFile): boolean =>
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
